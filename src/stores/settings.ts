import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { PlayButtonMode } from '@/lib/episode-logic';

type SettingsState = {
  playButtonMode: PlayButtonMode;
  maxConcurrentDownloads: number;
  /** Comma-separated ISO 639-1 codes for OpenSubtitles searches ("en,de"). */
  subtitleLanguages: string;
  osApiKey: string;
  osUsername: string;
  setPlayButtonMode: (mode: PlayButtonMode) => void;
  setMaxConcurrentDownloads: (n: number) => void;
  setSubtitleLanguages: (languages: string) => void;
  setOsApiKey: (key: string) => void;
  setOsUsername: (username: string) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      playButtonMode: 'smart',
      maxConcurrentDownloads: 2,
      subtitleLanguages: 'en',
      osApiKey: '',
      osUsername: '',
      setPlayButtonMode: (playButtonMode) => set({ playButtonMode }),
      setMaxConcurrentDownloads: (maxConcurrentDownloads) => set({ maxConcurrentDownloads }),
      setSubtitleLanguages: (subtitleLanguages) => set({ subtitleLanguages }),
      setOsApiKey: (osApiKey) => set({ osApiKey }),
      setOsUsername: (osUsername) => set({ osUsername }),
    }),
    {
      name: 'jellyfinner-settings',
      storage: createJSONStorage(() => Storage),
    }
  )
);
