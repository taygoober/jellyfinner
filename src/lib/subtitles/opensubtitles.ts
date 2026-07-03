import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { APP_NAME, APP_VERSION } from '@/lib/jellyfin';
import { useSettings } from '@/stores/settings';

import { parseSubtitles, type SubtitleCue } from './parse';

const BASE = 'https://api.opensubtitles.com/api/v1';

/** Password lives in the keychain, everything else in normal settings. */
export const OS_PASSWORD_KEY = 'jellyfinner.opensubtitles.password';

export type OsSubtitle = {
  fileId: number;
  language: string;
  release: string;
  downloads: number;
};

export type OsSearchParams = {
  imdbId?: string | null;
  parentImdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  query?: string | null;
};

type OsSearchResponse = {
  data?: {
    attributes?: {
      language?: string;
      release?: string;
      download_count?: number;
      files?: { file_id?: number; file_name?: string }[];
    };
  }[];
};

let cachedToken: { value: string; expires: number } | null = null;

function baseHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const apiKey = useSettings.getState().osApiKey.trim();
  if (!apiKey) throw new Error('Add your OpenSubtitles API key in Settings first');
  return {
    'Api-Key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `${APP_NAME} v${APP_VERSION}`,
    ...extra,
  };
}

async function login(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  const username = useSettings.getState().osUsername.trim();
  const password = (await SecureStore.getItemAsync(OS_PASSWORD_KEY)) ?? '';
  if (!username || !password) {
    throw new Error('Downloads need an OpenSubtitles account — add it in Settings');
  }
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: baseHeaders(),
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'OpenSubtitles rejected your username/password'
        : `OpenSubtitles login failed (${res.status})`
    );
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error('OpenSubtitles login returned no token');
  cachedToken = { value: data.token, expires: Date.now() + 20 * 3600 * 1000 };
  return data.token;
}

const imdbDigits = (imdb: string) => imdb.replace(/\D/g, '');

export async function searchSubtitles(params: OsSearchParams): Promise<OsSubtitle[]> {
  const q = new URLSearchParams();
  const languages = useSettings.getState().subtitleLanguages.replace(/\s/g, '').toLowerCase();
  if (languages) q.set('languages', languages);
  if (params.imdbId) q.set('imdb_id', imdbDigits(params.imdbId));
  if (params.parentImdbId) q.set('parent_imdb_id', imdbDigits(params.parentImdbId));
  if (params.season != null) q.set('season_number', String(params.season));
  if (params.episode != null) q.set('episode_number', String(params.episode));
  if (!params.imdbId && !params.parentImdbId && params.query) q.set('query', params.query);

  const res = await fetch(`${BASE}/subtitles?${q.toString()}`, { headers: baseHeaders() });
  if (!res.ok) throw new Error(`OpenSubtitles search failed (${res.status})`);
  const data = (await res.json()) as OsSearchResponse;
  return (data.data ?? []).flatMap((entry) => {
    const attrs = entry.attributes;
    const file = attrs?.files?.[0];
    if (!file?.file_id) return [];
    return [
      {
        fileId: file.file_id,
        language: attrs?.language ?? '?',
        release: attrs?.release ?? file.file_name ?? 'Unknown release',
        downloads: attrs?.download_count ?? 0,
      },
    ];
  });
}

function cacheDir(itemId: string): Directory {
  return new Directory(Paths.document, 'subtitles', itemId);
}

export type CachedSubtitle = { fileId: number; language: string; release: string };

/** Subtitles already on disk for this item — usable offline, no quota cost. */
export function listCachedSubtitles(itemId: string): CachedSubtitle[] {
  const dir = cacheDir(itemId);
  if (!dir.exists) return [];
  const out: CachedSubtitle[] = [];
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith('.json')) {
      try {
        out.push(JSON.parse(entry.textSync()) as CachedSubtitle);
      } catch {
        // Corrupt meta file — skip it.
      }
    }
  }
  return out;
}

export function isSubtitleCached(itemId: string, fileId: number): boolean {
  return new File(cacheDir(itemId), `${fileId}.srt`).exists;
}

/**
 * Cache-first load: a previously downloaded file never hits the network again
 * (OpenSubtitles has a daily download quota).
 */
export async function loadSubtitle(
  itemId: string,
  sub: { fileId: number; language: string; release: string }
): Promise<SubtitleCue[]> {
  const dir = cacheDir(itemId);
  const srtFile = new File(dir, `${sub.fileId}.srt`);
  if (srtFile.exists) return parseSubtitles(await srtFile.text());

  const token = await login();
  const res = await fetch(`${BASE}/download`, {
    method: 'POST',
    headers: baseHeaders({ Authorization: `Bearer ${token}` }),
    body: JSON.stringify({ file_id: sub.fileId }),
  });
  if (res.status === 406) throw new Error('OpenSubtitles download quota reached for today');
  if (!res.ok) throw new Error(`OpenSubtitles download failed (${res.status})`);
  const data = (await res.json()) as { link?: string; message?: string };
  if (!data.link) throw new Error(data.message ?? 'OpenSubtitles returned no download link');

  const fileRes = await fetch(data.link);
  if (!fileRes.ok) throw new Error(`Subtitle file fetch failed (${fileRes.status})`);
  const content = await fileRes.text();

  try {
    dir.create({ intermediates: true, idempotent: true });
    srtFile.write(content);
    new File(dir, `${sub.fileId}.json`).write(
      JSON.stringify({ fileId: sub.fileId, language: sub.language, release: sub.release })
    );
  } catch {
    // Caching is best-effort; playback continues with the in-memory copy.
  }
  return parseSubtitles(content);
}
