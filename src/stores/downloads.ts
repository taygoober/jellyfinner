import { create } from 'zustand';

import type { DownloadRow } from '@/lib/downloads/db';

type DownloadsState = {
  rows: Record<string, DownloadRow>;
  setRows: (rows: DownloadRow[]) => void;
};

/** Reactive mirror of the SQLite download registry; the manager keeps it in sync. */
export const useDownloads = create<DownloadsState>()((set) => ({
  rows: {},
  setRows: (list) => set({ rows: Object.fromEntries(list.map((r) => [r.itemId, r])) }),
}));

export function useDownloadRow(itemId: string | null | undefined): DownloadRow | undefined {
  return useDownloads((s) => (itemId ? s.rows[itemId] : undefined));
}
