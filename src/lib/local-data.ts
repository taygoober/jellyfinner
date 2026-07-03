import { db } from '@/lib/db';
import { useLocalData } from '@/stores/local-data';

/**
 * Local overrides Jellyfin refuses to offer:
 * - episode_order: the user's manual playback order for a series
 * - series_merge: duplicate library entries folded into one page
 * Both are device-local and never touch the server.
 */
export function initLocalData(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS episode_order (
      seriesId TEXT NOT NULL,
      itemId TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (seriesId, itemId)
    );
    CREATE TABLE IF NOT EXISTS series_merge (
      secondaryId TEXT PRIMARY KEY NOT NULL,
      primaryId TEXT NOT NULL
    );
  `);
  refresh();
}

function refresh(): void {
  const orderRows = db.getAllSync<{ seriesId: string; itemId: string; position: number }>(
    'SELECT seriesId, itemId, position FROM episode_order'
  );
  const mergeRows = db.getAllSync<{ secondaryId: string; primaryId: string }>(
    'SELECT secondaryId, primaryId FROM series_merge'
  );
  const episodeOrder: Record<string, Record<string, number>> = {};
  for (const row of orderRows) {
    (episodeOrder[row.seriesId] ??= {})[row.itemId] = row.position;
  }
  useLocalData.getState().set({
    episodeOrder,
    merges: Object.fromEntries(mergeRows.map((r) => [r.secondaryId, r.primaryId])),
  });
}

/** Persist one season's episodes in the order the user arranged them. */
export function saveEpisodeOrder(seriesId: string, orderedItemIds: string[]): void {
  db.withTransactionSync(() => {
    orderedItemIds.forEach((itemId, position) => {
      db.runSync(
        'INSERT OR REPLACE INTO episode_order (seriesId, itemId, position) VALUES (?, ?, ?)',
        seriesId,
        itemId,
        position
      );
    });
  });
  refresh();
}

/** Back to Jellyfin's natural order for these episodes. */
export function clearEpisodeOrder(seriesId: string, itemIds: string[]): void {
  db.withTransactionSync(() => {
    for (const itemId of itemIds) {
      db.runSync('DELETE FROM episode_order WHERE seriesId = ? AND itemId = ?', seriesId, itemId);
    }
  });
  refresh();
}

/** Fold `secondaryId` into `primaryId`'s page. */
export function mergeSeries(secondaryId: string, primaryId: string): void {
  db.withTransactionSync(() => {
    // Anything already merged into the secondary follows it to the new primary.
    db.runSync('UPDATE series_merge SET primaryId = ? WHERE primaryId = ?', primaryId, secondaryId);
    db.runSync(
      'INSERT OR REPLACE INTO series_merge (secondaryId, primaryId) VALUES (?, ?)',
      secondaryId,
      primaryId
    );
  });
  refresh();
}

/** Split all merged entries off this primary again. */
export function unmergeSeries(primaryId: string): void {
  db.runSync('DELETE FROM series_merge WHERE primaryId = ?', primaryId);
  refresh();
}
