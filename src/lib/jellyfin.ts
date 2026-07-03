import { Jellyfin } from '@jellyfin/sdk';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';

export const APP_NAME = 'Jellyfinner';
export const APP_VERSION = '0.1.0';

export function createJellyfin(deviceId: string, deviceName: string): Jellyfin {
  return new Jellyfin({
    clientInfo: { name: APP_NAME, version: APP_VERSION },
    deviceInfo: { name: deviceName, id: deviceId },
  });
}

/**
 * Users type things like "192.168.1.5:8096" — try https first, then http.
 * Returns candidate base URLs in the order they should be probed.
 */
export function serverUrlCandidates(input: string): string[] {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return [trimmed];
  return [`https://${trimmed}`, `http://${trimmed}`];
}

export type ServerInfo = { url: string; serverName: string; version: string };

/** Probe the address and return the first URL that answers as a Jellyfin server. */
export async function checkServer(jellyfin: Jellyfin, input: string): Promise<ServerInfo> {
  let lastError: unknown;
  for (const url of serverUrlCandidates(input)) {
    try {
      const api = jellyfin.createApi(url);
      const res = await getSystemApi(api).getPublicSystemInfo({ timeout: 7000 });
      return {
        url,
        serverName: res.data.ServerName ?? url,
        version: res.data.Version ?? 'unknown',
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not reach a Jellyfin server at this address');
}
