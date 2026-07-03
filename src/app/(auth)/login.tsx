import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/stores/auth';

export default function LoginScreen() {
  const router = useRouter();
  const { url, name } = useLocalSearchParams<{ url: string; name: string }>();
  const login = useAuth((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    if (!username.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login({ url, serverName: name ?? url, version: '' }, username.trim(), password);
      // Stack.Protected flips over to the app once the session exists.
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : 'Sign-in failed — check your credentials'
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-white">Sign in</Text>
        <Text className="mb-10 mt-2 text-base text-muted">{name ?? url}</Text>

        <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Username
        </Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          className="mb-4 rounded-xl bg-surface px-4 py-3.5 text-base text-white"
        />

        <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Password
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={signIn}
          className="rounded-xl bg-surface px-4 py-3.5 text-base text-white"
        />

        {error && <Text className="mt-3 text-sm text-red-400">{error}</Text>}

        <Pressable
          onPress={signIn}
          disabled={busy || !username.trim()}
          className="mt-6 items-center rounded-xl bg-accent py-3.5 active:opacity-80 disabled:opacity-40">
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">Sign in</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.back()} className="mt-4 items-center py-2">
          <Text className="text-sm text-muted">Different server</Text>
        </Pressable>

        <View className="h-24" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
