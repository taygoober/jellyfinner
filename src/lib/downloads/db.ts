import { db } from '@/lib/db';

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed';

export type DownloadRow = {
  itemId: string;
  mediaSourceId: string;
  url: string;
  ext: string;
  name: string;
  episodeCode: string | null;
  seriesId: string | null;
  seriesName: string | null;
  seasonId: string | null;
  /** Filename relative to the downloads folder — the durable identity of the file. */
  relPath: string | null;
  /** Legacy absolute URI. No longer read: the container UUID changes across reinstalls. */
  fileUri: string | null;
  status: DownloadStatus;
  /** 0..1, or -1 when the total size is unknown (transcoded downloads). */
  progress: number;
  sizeBytes: number | null;
  /** Offline watch position in ticks; 0 when unwatched. Persisted during local playback. */
  positionTicks: number;
  /** Total runtime in ticks, so the downloads list can show a watch-progress bar. */
  runtimeTicks: number | null;
  /** 1 when positionTicks was set offline and still needs pushing to the server. */
  progressDirty: number;
  error: string | null;
  createdAt: number;
};

export function initDownloadsDb(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS downloads (
      itemId TEXT PRIMARY KEY NOT NULL,
      mediaSourceId TEXT NOT NULL,
      url TEXT NOT NULL,
      ext TEXT NOT NULL,
      name TEXT NOT NULL,
      episodeCode TEXT,
      seriesId TEXT,
      seriesName TEXT,
      seasonId TEXT,
      relPath TEXT,
      fileUri TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0,
      sizeBytes INTEGER,
      positionTicks INTEGER NOT NULL DEFAULT 0,
      runtimeTicks INTEGER,
      progressDirty INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      createdAt INTEGER NOT NULL
    );
  `);
  // Upgrade path: tables created before relPath existed. Add the column, then
  // backfill it from the old itemId-based filename so existing downloads keep
  // resolving after the app updates and the container UUID changes.
  const cols = db.getAllSync<{ name: string }>('PRAGMA table_info(downloads)');
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has('relPath')) db.execSync('ALTER TABLE downloads ADD COLUMN relPath TEXT');
  if (!has('positionTicks')) {
    db.execSync('ALTER TABLE downloads ADD COLUMN positionTicks INTEGER NOT NULL DEFAULT 0');
  }
  if (!has('runtimeTicks')) db.execSync('ALTER TABLE downloads ADD COLUMN runtimeTicks INTEGER');
  if (!has('progressDirty')) {
    db.execSync('ALTER TABLE downloads ADD COLUMN progressDirty INTEGER NOT NULL DEFAULT 0');
  }
  db.runSync(`UPDATE downloads SET relPath = itemId || '.' || ext WHERE relPath IS NULL`);
}

export function listDownloads(): DownloadRow[] {
  return db.getAllSync<DownloadRow>('SELECT * FROM downloads ORDER BY createdAt ASC');
}

export function getDownload(itemId: string): DownloadRow | null {
  return db.getFirstSync<DownloadRow>('SELECT * FROM downloads WHERE itemId = ?', itemId);
}

export function insertQueued(
  row: Pick<
    DownloadRow,
    | 'itemId'
    | 'mediaSourceId'
    | 'url'
    | 'ext'
    | 'name'
    | 'episodeCode'
    | 'seriesId'
    | 'seriesName'
    | 'seasonId'
    | 'relPath'
    | 'runtimeTicks'
  >
): void {
  db.runSync(
    `INSERT OR REPLACE INTO downloads
      (itemId, mediaSourceId, url, ext, name, episodeCode, seriesId, seriesName, seasonId,
       relPath, runtimeTicks, fileUri, status, progress, sizeBytes, positionTicks, error, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', 0, NULL, 0, NULL, ?)`,
    row.itemId,
    row.mediaSourceId,
    row.url,
    row.ext,
    row.name,
    row.episodeCode,
    row.seriesId,
    row.seriesName,
    row.seasonId,
    row.relPath,
    row.runtimeTicks,
    Date.now()
  );
}

export function setStatus(itemId: string, status: DownloadStatus, error?: string): void {
  db.runSync(
    'UPDATE downloads SET status = ?, error = ? WHERE itemId = ?',
    status,
    error ?? null,
    itemId
  );
}

export function setProgress(itemId: string, progress: number): void {
  db.runSync('UPDATE downloads SET progress = ? WHERE itemId = ?', progress, itemId);
}

export function markDone(itemId: string, sizeBytes: number | null): void {
  // relPath was fixed at enqueue time; a finished download just flips status/size.
  db.runSync(
    `UPDATE downloads SET status = 'done', progress = 1, sizeBytes = ?, error = NULL
     WHERE itemId = ?`,
    sizeBytes,
    itemId
  );
}

/**
 * Persist a watch position for a downloaded item. Keeps the best runtime we
 * know (metadata or player). `dirty` marks whether this position still owes the
 * server an update: true when it came from local playback, false when it was
 * mirrored down from a server report that already has it.
 */
export function setPlaybackProgress(
  itemId: string,
  positionTicks: number,
  runtimeTicks: number | null,
  dirty: boolean
): void {
  db.runSync(
    `UPDATE downloads SET positionTicks = ?, runtimeTicks = COALESCE(?, runtimeTicks), progressDirty = ?
     WHERE itemId = ?`,
    positionTicks,
    runtimeTicks,
    dirty ? 1 : 0,
    itemId
  );
}

/** Every download whose local position still needs pushing to the server. */
export function listDirtyProgress(): DownloadRow[] {
  return db.getAllSync<DownloadRow>(
    'SELECT * FROM downloads WHERE progressDirty = 1 AND positionTicks > 0'
  );
}

/** Mark an item's position as accepted by the server. */
export function clearProgressDirty(itemId: string): void {
  db.runSync('UPDATE downloads SET progressDirty = 0 WHERE itemId = ?', itemId);
}

export function removeDownload(itemId: string): void {
  db.runSync('DELETE FROM downloads WHERE itemId = ?', itemId);
}

/** Rows left in 'downloading' after an app kill go back to the queue. */
export function resetInterrupted(): void {
  db.runSync(`UPDATE downloads SET status = 'queued', progress = 0 WHERE status = 'downloading'`);
}
