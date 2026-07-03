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
  fileUri: string | null;
  status: DownloadStatus;
  /** 0..1, or -1 when the total size is unknown (transcoded downloads). */
  progress: number;
  sizeBytes: number | null;
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
      fileUri TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0,
      sizeBytes INTEGER,
      error TEXT,
      createdAt INTEGER NOT NULL
    );
  `);
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
  >
): void {
  db.runSync(
    `INSERT OR REPLACE INTO downloads
      (itemId, mediaSourceId, url, ext, name, episodeCode, seriesId, seriesName, seasonId,
       fileUri, status, progress, sizeBytes, error, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', 0, NULL, NULL, ?)`,
    row.itemId,
    row.mediaSourceId,
    row.url,
    row.ext,
    row.name,
    row.episodeCode,
    row.seriesId,
    row.seriesName,
    row.seasonId,
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

export function markDone(itemId: string, fileUri: string, sizeBytes: number | null): void {
  db.runSync(
    `UPDATE downloads SET status = 'done', progress = 1, fileUri = ?, sizeBytes = ?, error = NULL
     WHERE itemId = ?`,
    fileUri,
    sizeBytes,
    itemId
  );
}

export function removeDownload(itemId: string): void {
  db.runSync('DELETE FROM downloads WHERE itemId = ?', itemId);
}

/** Rows left in 'downloading' after an app kill go back to the queue. */
export function resetInterrupted(): void {
  db.runSync(`UPDATE downloads SET status = 'queued', progress = 0 WHERE status = 'downloading'`);
}
