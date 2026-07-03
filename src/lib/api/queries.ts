import {
  BaseItemKind,
  ItemFields,
  ItemSortBy,
  SortOrder,
  type BaseItemDto,
} from '@jellyfin/sdk/lib/generated-client/models';
import { getItemsApi } from '@jellyfin/sdk/lib/utils/api/items-api';
import { getTvShowsApi } from '@jellyfin/sdk/lib/utils/api/tv-shows-api';
import { getUserLibraryApi } from '@jellyfin/sdk/lib/utils/api/user-library-api';
import { getUserViewsApi } from '@jellyfin/sdk/lib/utils/api/user-views-api';
import { useQuery } from '@tanstack/react-query';

import { useApi, useSessionInfo } from '@/stores/auth';

/** The user's libraries (Movies, Shows, ...). */
export function useUserViews() {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['userViews', userId],
    queryFn: async () =>
      (await getUserViewsApi(api).getUserViews({ userId })).data.Items ?? [],
  });
}

/** Continue Watching row. */
export function useResumeItems() {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['resumeItems', userId],
    queryFn: async () =>
      (
        await getItemsApi(api).getResumeItems({
          userId,
          limit: 12,
          enableTotalRecordCount: false,
        })
      ).data.Items ?? [],
  });
}

/** Next Up row. */
export function useNextUp() {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['nextUp', userId],
    queryFn: async () =>
      (
        await getTvShowsApi(api).getNextUp({
          userId,
          limit: 12,
          enableTotalRecordCount: false,
        })
      ).data.Items ?? [],
  });
}

/** Recently added across all libraries. */
export function useLatestMedia() {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['latestMedia', userId],
    queryFn: async () =>
      (await getUserLibraryApi(api).getLatestMedia({ userId, limit: 16 })).data,
  });
}

/** All series/movies inside one library view. */
export function useLibraryItems(parentId: string | undefined) {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['libraryItems', userId, parentId],
    enabled: !!parentId,
    queryFn: async () =>
      (
        await getItemsApi(api).getItems({
          userId,
          parentId,
          recursive: true,
          includeItemTypes: [BaseItemKind.Series, BaseItemKind.Movie],
          sortBy: [ItemSortBy.SortName],
          sortOrder: [SortOrder.Ascending],
          imageTypeLimit: 1,
          enableTotalRecordCount: false,
        })
      ).data.Items ?? [],
  });
}

/** Full detail for one item (series, movie, episode). */
export function useItem(itemId: string | undefined) {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['item', userId, itemId],
    enabled: !!itemId,
    queryFn: async () =>
      (await getUserLibraryApi(api).getItem({ userId, itemId: itemId! })).data,
  });
}

/** Season list of a series (for the season chips). */
export function useSeasons(seriesId: string | undefined) {
  const api = useApi();
  const { userId } = useSessionInfo();
  return useQuery({
    queryKey: ['seasons', userId, seriesId],
    enabled: !!seriesId,
    queryFn: async () =>
      (await getTvShowsApi(api).getSeasons({ seriesId: seriesId!, userId })).data.Items ?? [],
  });
}

/**
 * Every episode of a series (and of any duplicate entries merged into it),
 * including MediaSources so the UI can show version counts. The play-target
 * logic needs the whole series, not just the selected season.
 */
export function useSeriesEpisodes(seriesId: string | undefined, mergedSeriesIds: string[] = []) {
  const api = useApi();
  const { userId } = useSessionInfo();
  const ids = seriesId ? [seriesId, ...mergedSeriesIds] : [];
  return useQuery({
    queryKey: ['episodes', userId, ids.join('|')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        ids.map((id) =>
          getTvShowsApi(api).getEpisodes({
            seriesId: id,
            userId,
            fields: [ItemFields.MediaSources, ItemFields.Overview],
          })
        )
      );
      return results.flatMap((r) => r.data.Items ?? []);
    },
  });
}

const normalizeName = (name: string | null | undefined) =>
  (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Other library entries with the same name — the "two stacks of the same
 * show" problem. Candidates for merging into this page.
 */
export function useSameNameSeries(series: BaseItemDto | undefined) {
  const api = useApi();
  const { userId } = useSessionInfo();
  const name = series?.Name ?? undefined;
  return useQuery({
    queryKey: ['sameNameSeries', userId, series?.Id, name],
    enabled: !!series?.Id && !!name,
    queryFn: async () => {
      const items =
        (
          await getItemsApi(api).getItems({
            userId,
            recursive: true,
            includeItemTypes: [BaseItemKind.Series],
            searchTerm: name,
            enableTotalRecordCount: false,
          })
        ).data.Items ?? [];
      return items.filter(
        (i) => i.Id && i.Id !== series?.Id && normalizeName(i.Name) === normalizeName(name)
      );
    },
  });
}
