import { create } from 'zustand';

type LocalDataState = {
  /** seriesId -> itemId -> manual position. Positions only compete within one season. */
  episodeOrder: Record<string, Record<string, number>>;
  /** duplicate seriesId -> the seriesId whose page absorbs it. */
  merges: Record<string, string>;
  set: (data: Pick<LocalDataState, 'episodeOrder' | 'merges'>) => void;
};

/** Reactive mirror of the local-override tables; lib/local-data keeps it in sync. */
export const useLocalData = create<LocalDataState>()((set) => ({
  episodeOrder: {},
  merges: {},
  set: (data) => set(data),
}));
