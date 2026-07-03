import { useRouter } from 'expo-router';
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

export default function ServerScreen() {
  const router = useRouter();
  const probeServer = useAuth((s) => s.probeServer);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const server = await probeServer(input);
      router.push({
        pathname: '/login',
        params: { url: server.url, name: server.serverName },
      });
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'Could not reach a Jellyfin server at this address'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-center px-6">
        <Text className="text-4xl font-bold text-white">Jellyfinner</Text>
        <Text className="mb-10 mt-2 text-base text-muted">
          Connect to your Jellyfin server
        </Text>

        <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Server address
        </Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="192.168.1.10:8096 or https://jellyfin.example.com"
          placeholderTextColor="#52525b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={connect}
          className="rounded-xl bg-surface px-4 py-3.5 text-base text-white"
        />

        {error && <Text className="mt-3 text-sm text-red-400">{error}</Text>}

        <Pressable
          onPress={connect}
          disabled={busy || !input.trim()}
          className="mt-6 items-center rounded-xl bg-accent py-3.5 active:opacity-80 disabled:opacity-40">
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">Connect</Text>
          )}
        </Pressable>

        <View className="h-24" />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
