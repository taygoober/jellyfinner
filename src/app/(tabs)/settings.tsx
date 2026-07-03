import * as SecureStore from 'expo-secure-store';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlayButtonMode } from '@/lib/episode-logic';
import { APP_VERSION } from '@/lib/jellyfin';
import { OS_PASSWORD_KEY } from '@/lib/subtitles/opensubtitles';
import { useAuth, useSessionInfo } from '@/stores/auth';
import { useSettings } from '@/stores/settings';

const PLAY_MODES: { mode: PlayButtonMode; label: string; hint: string }[] = [
  {
    mode: 'smart',
    label: 'Smart',
    hint: 'Resume a started episode, else the next unwatched one',
  },
  {
    mode: 'next-unwatched',
    label: 'Next unwatched',
    hint: 'Always the first unwatched episode, ignoring partial progress',
  },
  {
    mode: 'first-episode',
    label: 'First episode',
    hint: 'Always S1E1',
  },
];

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="mb-2 mt-6 px-4 text-xs font-medium uppercase tracking-wide text-muted">
      {children}
    </Text>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  onEndEditing,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  onEndEditing?: () => void;
}) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs text-muted">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onEndEditing={onEndEditing}
        placeholder={placeholder}
        placeholderTextColor="#52525b"
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-lg bg-surface-high px-3 py-2.5 text-sm text-white"
      />
    </View>
  );
}

/** API key, account and languages for the OpenSubtitles player integration. */
function OpenSubtitlesSection() {
  const osApiKey = useSettings((s) => s.osApiKey);
  const osUsername = useSettings((s) => s.osUsername);
  const subtitleLanguages = useSettings((s) => s.subtitleLanguages);
  const setOsApiKey = useSettings((s) => s.setOsApiKey);
  const setOsUsername = useSettings((s) => s.setOsUsername);
  const setSubtitleLanguages = useSettings((s) => s.setSubtitleLanguages);

  // The password never enters the settings store — it lives in the keychain.
  const [password, setPassword] = useState('');
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  useEffect(() => {
    void SecureStore.getItemAsync(OS_PASSWORD_KEY).then((v) => setHasStoredPassword(!!v));
  }, []);

  const savePassword = () => {
    const trimmed = password.trim();
    if (!trimmed) return;
    void SecureStore.setItemAsync(OS_PASSWORD_KEY, trimmed).then(() => {
      setHasStoredPassword(true);
      setPassword('');
    });
  };

  return (
    <>
      <SectionTitle>OpenSubtitles</SectionTitle>
      <View className="mx-4 rounded-xl bg-surface p-4">
        <Text className="mb-3 text-xs leading-5 text-muted">
          Searching needs a free API key (opensubtitles.com → API consumers); downloading also
          needs your account login. Downloaded subtitles are cached on the device and work
          offline.
        </Text>
        <LabeledInput
          label="API key"
          value={osApiKey}
          onChangeText={setOsApiKey}
          placeholder="e.g. AbCdEf123..."
        />
        <LabeledInput
          label="Username"
          value={osUsername}
          onChangeText={setOsUsername}
          placeholder="Your OpenSubtitles username"
        />
        <LabeledInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          onEndEditing={savePassword}
          placeholder={hasStoredPassword ? '•••••••• (saved)' : 'Your OpenSubtitles password'}
          secure
        />
        <LabeledInput
          label="Subtitle languages (comma-separated codes)"
          value={subtitleLanguages}
          onChangeText={setSubtitleLanguages}
          placeholder="en,de"
        />
      </View>
    </>
  );
}

export default function SettingsScreen() {
  const { serverName, serverUrl, userName } = useSessionInfo();
  const logout = useAuth((s) => s.logout);
  const playButtonMode = useSettings((s) => s.playButtonMode);
  const setPlayButtonMode = useSettings((s) => s.setPlayButtonMode);
  const maxConcurrent = useSettings((s) => s.maxConcurrentDownloads);
  const setMaxConcurrent = useSettings((s) => s.setMaxConcurrentDownloads);

  const confirmSignOut = () => {
    Alert.alert('Sign out', `Sign out of ${serverName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <Text className="px-4 pb-2 pt-2 text-2xl font-bold text-white">Settings</Text>

        <SectionTitle>Server</SectionTitle>
        <View className="mx-4 rounded-xl bg-surface p-4">
          <Text className="text-base font-medium text-white">{serverName}</Text>
          <Text className="mt-0.5 text-xs text-muted">{serverUrl}</Text>
          <Text className="mt-0.5 text-xs text-muted">Signed in as {userName}</Text>
          <Pressable onPress={confirmSignOut} className="mt-3 self-start active:opacity-60">
            <Text className="text-sm font-medium text-red-400">Sign out</Text>
          </Pressable>
        </View>

        <SectionTitle>Play button picks</SectionTitle>
        <View className="mx-4 overflow-hidden rounded-xl bg-surface">
          {PLAY_MODES.map(({ mode, label, hint }, i) => (
            <Pressable
              key={mode}
              onPress={() => setPlayButtonMode(mode)}
              className={`flex-row items-center gap-3 p-4 active:bg-surface-high ${
                i > 0 ? 'border-t border-white/5' : ''
              }`}>
              <View className="flex-1">
                <Text className="text-sm font-medium text-white">{label}</Text>
                <Text className="mt-0.5 text-xs text-muted">{hint}</Text>
              </View>
              {playButtonMode === mode && (
                <SymbolView name="checkmark" size={16} tintColor="#8b5cf6" />
              )}
            </Pressable>
          ))}
        </View>

        <SectionTitle>Parallel downloads</SectionTitle>
        <View className="mx-4 flex-row gap-2">
          {[1, 2, 3].map((n) => (
            <Pressable
              key={n}
              onPress={() => setMaxConcurrent(n)}
              className={`flex-1 items-center rounded-xl py-3 ${
                maxConcurrent === n ? 'bg-accent' : 'bg-surface active:bg-surface-high'
              }`}>
              <Text
                className={`text-base font-semibold ${
                  maxConcurrent === n ? 'text-white' : 'text-muted'
                }`}>
                {n}
              </Text>
            </Pressable>
          ))}
        </View>

        <OpenSubtitlesSection />

        <Text className="mt-10 text-center text-xs text-muted">Jellyfinner {APP_VERSION}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
