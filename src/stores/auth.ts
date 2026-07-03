import type { Api, Jellyfin } from '@jellyfin/sdk';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { getDeviceId, getDeviceName } from '@/lib/device';
import { checkServer, createJellyfin, type ServerInfo } from '@/lib/jellyfin';

export type Session = {
  serverUrl: string;
  serverName: string;
  accessToken: string;
  userId: string;
  userName: string;
};

const SESSION_KEY = 'jellyfinner.session';

type AuthState = {
  hydrated: boolean;
  deviceId: string | null;
  jellyfin: Jellyfin | null;
  api: Api | null;
  session: Session | null;
  hydrate: () => Promise<void>;
  probeServer: (input: string) => Promise<ServerInfo>;
  login: (server: ServerInfo, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuth = create<AuthState>()((set, get) => ({
  hydrated: false,
  deviceId: null,
  jellyfin: null,
  api: null,
  session: null,

  hydrate: async () => {
    try {
      const deviceId = await getDeviceId();
      const jellyfin = createJellyfin(deviceId, getDeviceName());
      let api: Api | null = null;
      let session: Session | null = null;
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      if (raw) {
        session = JSON.parse(raw) as Session;
        api = jellyfin.createApi(session.serverUrl, session.accessToken);
      }
      set({ hydrated: true, deviceId, jellyfin, api, session });
    } catch {
      set({ hydrated: true });
    }
  },

  probeServer: async (input) => {
    const { jellyfin } = get();
    if (!jellyfin) throw new Error('App is still starting up — try again');
    return checkServer(jellyfin, input);
  },

  login: async (server, username, password) => {
    const { jellyfin } = get();
    if (!jellyfin) throw new Error('App is still starting up — try again');
    const api = jellyfin.createApi(server.url);
    const res = await api.authenticateUserByName(username, password);
    const accessToken = res.data.AccessToken;
    const user = res.data.User;
    if (!accessToken || !user?.Id) {
      throw new Error('Server accepted the request but returned no session');
    }
    const session: Session = {
      serverUrl: server.url,
      serverName: server.serverName,
      accessToken,
      userId: user.Id,
      userName: user.Name ?? username,
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    set({ api, session });
  },

  logout: async () => {
    const { api } = get();
    try {
      await api?.logout();
    } catch {
      // Server may be unreachable — still sign out locally.
    }
    await SecureStore.deleteItemAsync(SESSION_KEY);
    set({ api: null, session: null });
  },
}));

/** For screens that only render while authenticated (behind Stack.Protected). */
export function useApi(): Api {
  const api = useAuth((s) => s.api);
  if (!api) throw new Error('useApi called while signed out');
  return api;
}

export function useSessionInfo(): Session {
  const session = useAuth((s) => s.session);
  if (!session) throw new Error('useSessionInfo called while signed out');
  return session;
}
