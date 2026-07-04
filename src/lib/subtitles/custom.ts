import type { Api } from '@jellyfin/sdk';
import { getSubtitleApi } from '@jellyfin/sdk/lib/utils/api/subtitle-api';
import { Directory, File, Paths } from 'expo-file-system';

import { decodeSubtitleBytes, parseSubtitles, type SubtitleCue } from './parse';

/**
 * User-supplied subtitle files, attached to one specific item. Stored on
 * device (works offline) and uploadable to the Jellyfin server, where they
 * become a regular external subtitle stream for every client.
 */

const customDir = (itemId: string) => new Directory(Paths.document, 'custom-subtitles', itemId);

export type CustomSubtitle = {
  id: string;
  /** Display name — the picked file's name without the extension. */
  label: string;
  /** ISO 639 code guessed from the filename ("….en.srt" → "en"). */
  language: string;
  /** 'srt' | 'vtt' — kept for the server upload's Format field. */
  format: string;
  /** True only after the server accepted the upload. Never assumed. */
  synced: boolean;
  createdAt: number;
};

const subFile = (itemId: string, meta: Pick<CustomSubtitle, 'id' | 'format'>) =>
  new File(customDir(itemId), `${meta.id}.${meta.format}`);
const metaFile = (itemId: string, id: string) => new File(customDir(itemId), `${id}.json`);

/** All custom subtitle files saved for this item, newest first. */
export function listCustomSubtitles(itemId: string): CustomSubtitle[] {
  const dir = customDir(itemId);
  if (!dir.exists) return [];
  const out: CustomSubtitle[] = [];
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith('.json')) {
      try {
        out.push(JSON.parse(entry.textSync()) as CustomSubtitle);
      } catch {
        // Corrupt meta file — skip it.
      }
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function guessLanguage(fileName: string): string {
  // "Show.1x03.something.en.srt" → "en"; token before the extension, 2-3 letters.
  const parts = fileName.toLowerCase().split('.');
  const candidate = parts.length >= 3 ? parts[parts.length - 2] : '';
  return /^[a-z]{2,3}$/.test(candidate) ? candidate : 'en';
}

/**
 * Import a picked file: validate, parse, persist. Returns the cues so the
 * caller can activate the subtitle immediately.
 */
export async function addCustomSubtitle(
  itemId: string,
  picked: { uri: string; name: string }
): Promise<{ meta: CustomSubtitle; cues: SubtitleCue[] }> {
  const lower = picked.name.toLowerCase();
  const format = lower.endsWith('.srt') ? 'srt' : lower.endsWith('.vtt') ? 'vtt' : null;
  if (!format) throw new Error('Pick an .srt or .vtt file');

  // Read raw bytes and decode ourselves: iOS's own text decoding refuses to
  // guess the encoding of Windows-1252 files, which most scene SRTs are.
  const content = decodeSubtitleBytes(await new File(picked.uri).bytes());
  const cues = parseSubtitles(content);
  if (cues.length === 0) throw new Error('No usable cues found in that file');

  const meta: CustomSubtitle = {
    id: String(Date.now()),
    label: picked.name.replace(/\.(srt|vtt)$/i, ''),
    language: guessLanguage(picked.name),
    format,
    synced: false,
    createdAt: Date.now(),
  };
  const dir = customDir(itemId);
  dir.create({ intermediates: true, idempotent: true });
  subFile(itemId, meta).write(content);
  metaFile(itemId, meta.id).write(JSON.stringify(meta));
  return { meta, cues };
}

export async function loadCustomSubtitle(
  itemId: string,
  meta: CustomSubtitle
): Promise<SubtitleCue[]> {
  return parseSubtitles(await subFile(itemId, meta).text());
}

/**
 * Push the file to the Jellyfin server, where it becomes an external subtitle
 * stream of the item. The synced flag flips only on server confirmation.
 * Requires the user to have subtitle management permission on the server.
 */
export async function syncCustomSubtitle(
  api: Api,
  itemId: string,
  meta: CustomSubtitle
): Promise<void> {
  const data = await subFile(itemId, meta).base64();
  await getSubtitleApi(api).uploadSubtitle({
    itemId,
    uploadSubtitleDto: {
      Language: meta.language,
      Format: meta.format,
      IsForced: false,
      IsHearingImpaired: false,
      Data: data,
    },
  });
  const updated: CustomSubtitle = { ...meta, synced: true };
  metaFile(itemId, meta.id).write(JSON.stringify(updated));
}

/**
 * Retry every pending upload, across all items. The meta files ARE the job
 * queue: synced=false + the file on disk is everything a retry needs, so jobs
 * survive app restarts and offline periods for free. Called on app start and
 * whenever a subtitle sheet opens; failures simply stay queued.
 */
export async function syncPendingSubtitles(api: Api): Promise<void> {
  const root = new Directory(Paths.document, 'custom-subtitles');
  if (!root.exists) return;
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    for (const meta of listCustomSubtitles(entry.name)) {
      if (meta.synced) continue;
      try {
        await syncCustomSubtitle(api, entry.name, meta);
      } catch {
        // Offline or server refused — stays queued for the next sweep.
      }
    }
  }
}

export function deleteCustomSubtitle(itemId: string, meta: CustomSubtitle): void {
  for (const file of [subFile(itemId, meta), metaFile(itemId, meta.id)]) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Already gone.
    }
  }
}
