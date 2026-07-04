import type { Api } from '@jellyfin/sdk';
import {
  BaseItemKind,
  type BaseItemDto,
  type MediaSourceInfo,
} from '@jellyfin/sdk/lib/generated-client/models';
import { Directory, File, Paths } from 'expo-file-system';

import { episodeCode } from '@/lib/format';
import { useDownloads } from '@/stores/downloads';
import { useSettings } from '@/stores/settings';

import * as ddb from './db';

const downloadsDir = new Directory(Paths.document, 'downloads');

let currentApi: Api | null = null;
let activeCount = 0;
const activeControllers = new Map<string, AbortController>();

function refreshStore(): void {
  useDownloads.getState().setRows(ddb.listDownloads());
}

/** The file's location right now — always rebuilt from the current container, never stored absolute. */
function fileFor(row: Pick<ddb.DownloadRow, 'itemId' | 'ext' | 'relPath'>): File {
  return new File(downloadsDir, row.relPath ?? `${row.itemId}.${row.ext}`);
}

/** Strip characters that are illegal in filenames (Files app / exFAT) and tidy whitespace. */
function sanitizeName(s: string): string {
  return s
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/, '');
}

/** A human-readable filename so downloads are recognisable in the Files app. */
function buildRelPath(entry: {
  itemId: string;
  ext: string;
  name: string;
  episodeCode: string | null;
  seriesName: string | null;
}): string {
  const base =
    entry.seriesName && entry.episodeCode
      ? `${entry.seriesName} - ${entry.episodeCode} - ${entry.name}`
      : entry.name;
  const stem = sanitizeName(base) || entry.itemId;
  const candidate = `${stem}.${entry.ext}`;
  // Guarantee one file per item: if the readable name is already taken by a
  // different download, disambiguate rather than clobber it.
  const taken = new Set(
    ddb
      .listDownloads()
      .filter((r) => r.itemId !== entry.itemId && r.relPath)
      .map((r) => r.relPath as string)
  );
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const next = `${stem} (${n}).${entry.ext}`;
    if (!taken.has(next)) return next;
  }
}

/** Call once on startup (and again after login) before using any other export. */
export function initDownloads(api: Api): void {
  currentApi = api;
  ddb.initDownloadsDb();
  try {
    downloadsDir.create({ intermediates: true, idempotent: true });
  } catch {
    // Already exists.
  }
  ddb.resetInterrupted();
  reconcile();
  refreshStore();
  pump();
}

/**
 * The registry never lies: a row only stays 'done' while its file actually
 * exists on disk. Anything else (cleared storage, failed writes) is dropped.
 */
function reconcile(): void {
  for (const row of ddb.listDownloads()) {
    if (row.status === 'done') {
      if (!fileFor(row).exists) ddb.removeDownload(row.itemId);
    }
  }
}

function buildDownloadUrl(
  api: Api,
  itemId: string,
  ms: MediaSourceInfo
): { url: string; ext: string } {
  const container = (ms.Container ?? '').toLowerCase();
  if (['mp4', 'm4v', 'mov'].includes(container)) {
    const params = new URLSearchParams({
      static: 'true',
      mediaSourceId: ms.Id ?? itemId,
      api_key: api.accessToken,
    });
    return {
      url: `${api.basePath}/Videos/${itemId}/stream.${container}?${params.toString()}`,
      ext: container,
    };
  }
  // Containers AVPlayer can't open (mkv & friends): have the server transcode
  // to a progressive mp4. Costs server CPU once, plays reliably forever.
  const params = new URLSearchParams({
    mediaSourceId: ms.Id ?? itemId,
    videoCodec: 'h264',
    audioCodec: 'aac',
    maxWidth: '1920',
    api_key: api.accessToken,
  });
  return { url: `${api.basePath}/Videos/${itemId}/stream.mp4?${params.toString()}`, ext: 'mp4' };
}

export type EnqueueEntry = { item: BaseItemDto; mediaSource?: MediaSourceInfo };

/** Queue any number of items at once ("download season" is just a bigger array). */
export function enqueueDownloads(api: Api, entries: EnqueueEntry[]): void {
  currentApi = api;
  for (const { item, mediaSource } of entries) {
    if (!item.Id) continue;
    const existing = ddb.getDownload(item.Id);
    if (existing && existing.status !== 'failed') continue;
    const ms = mediaSource ?? item.MediaSources?.[0];
    if (!ms) continue;
    const { url, ext } = buildDownloadUrl(api, item.Id, ms);
    const name = item.Name ?? 'Unknown';
    const epCode = item.Type === BaseItemKind.Episode ? episodeCode(item) : null;
    const seriesName = item.SeriesName ?? null;
    ddb.insertQueued({
      itemId: item.Id,
      mediaSourceId: ms.Id ?? item.Id,
      url,
      ext,
      name,
      episodeCode: epCode,
      seriesId: item.SeriesId ?? null,
      seriesName,
      seasonId: item.SeasonId ?? null,
      relPath: buildRelPath({ itemId: item.Id, ext, name, episodeCode: epCode, seriesName }),
      runtimeTicks: item.RunTimeTicks ?? null,
    });
  }
  refreshStore();
  pump();
}

function pump(): void {
  if (!currentApi) return;
  const max = useSettings.getState().maxConcurrentDownloads;
  while (activeCount < max) {
    const next = ddb
      .listDownloads()
      .find((r) => r.status === 'queued' && !activeControllers.has(r.itemId));
    if (!next) return;
    activeCount++;
    void runOne(next).finally(() => {
      activeCount--;
      pump();
    });
  }
}

async function runOne(row: ddb.DownloadRow): Promise<void> {
  ddb.setStatus(row.itemId, 'downloading');
  refreshStore();
  const controller = new AbortController();
  activeControllers.set(row.itemId, controller);
  try {
    // iOS can reclaim the document dir; make sure our folder exists every time.
    if (!downloadsDir.exists) downloadsDir.create({ intermediates: true, idempotent: true });
    const dest = fileFor(row);
    let lastPercent = -2;
    // idempotent overwrites any leftover/partial file instead of rejecting with
    // "cannot create file" (DestinationAlreadyExists) when the download finalizes.
    const file = await File.downloadFileAsync(row.url, dest, {
      idempotent: true,
      signal: controller.signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const progress = totalBytes > 0 ? bytesWritten / totalBytes : -1;
        const percent = progress >= 0 ? Math.floor(progress * 100) : -1;
        if (percent !== lastPercent) {
          lastPercent = percent;
          ddb.setProgress(row.itemId, progress);
          refreshStore();
        }
      },
    });
    ddb.markDone(row.itemId, file.size);
  } catch (e) {
    ddb.setStatus(row.itemId, 'failed', e instanceof Error ? e.message : String(e));
  } finally {
    activeControllers.delete(row.itemId);
    refreshStore();
  }
}

/** Cancel an active/queued download, or delete a finished one, file included. */
export function removeDownload(itemId: string): void {
  const controller = activeControllers.get(itemId);
  if (controller) {
    try {
      controller.abort();
    } catch {
      // Already finished or cancelled.
    }
  }
  const row = ddb.getDownload(itemId);
  // Delete the finished file, and any partial left behind by an aborted download.
  if (row) {
    try {
      const file = fileFor(row);
      if (file.exists) file.delete();
    } catch {
      // File already gone.
    }
  }
  ddb.removeDownload(itemId);
  refreshStore();
}

export function retryDownload(itemId: string): void {
  ddb.setStatus(itemId, 'queued');
  refreshStore();
  pump();
}

/** Persist offline watch position so a downloaded item resumes where it left off. */
export function saveLocalProgress(
  itemId: string,
  positionTicks: number,
  runtimeTicks: number | null
): void {
  ddb.setPlaybackProgress(itemId, positionTicks, runtimeTicks);
  refreshStore();
}

/** Resume position for a downloaded item; 0 once it's effectively watched to the end. */
export function localResumeTicks(itemId: string): number {
  const row = ddb.getDownload(itemId);
  if (!row || row.positionTicks <= 0) return 0;
  const runtime = row.runtimeTicks ?? 0;
  if (runtime > 0 && row.positionTicks / runtime >= 0.95) return 0;
  return row.positionTicks;
}

/** Local playable file for an item, when fully downloaded and still present on disk. */
export function localFileUri(itemId: string): string | null {
  const row = ddb.getDownload(itemId);
  if (row?.status !== 'done') return null;
  const file = fileFor(row);
  return file.exists ? file.uri : null;
}
