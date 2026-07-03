import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'jellyfinner.deviceId';

/** Stable per-install device id, reported to the Jellyfin server. */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDeviceName(): string {
  return Device.deviceName ?? 'iPhone';
}
