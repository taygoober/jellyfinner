import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';

function url(api: Api, itemId: string, type: string, tag: string, width: number, index?: number) {
  const indexPart = index != null ? `/${index}` : '';
  return `${api.basePath}/Items/${itemId}/Images/${type}${indexPart}?tag=${tag}&fillWidth=${width}&quality=90`;
}

/** Poster image; falls back to the parent series poster for episodes/seasons. */
export function primaryImageUrl(api: Api, item: BaseItemDto, width = 320): string | undefined {
  if (item.ImageTags?.Primary && item.Id) {
    return url(api, item.Id, 'Primary', item.ImageTags.Primary, width);
  }
  if (item.SeriesPrimaryImageTag && item.SeriesId) {
    return url(api, item.SeriesId, 'Primary', item.SeriesPrimaryImageTag, width);
  }
  return undefined;
}

/** Wide backdrop; falls back to parent backdrop, then poster. */
export function backdropImageUrl(api: Api, item: BaseItemDto, width = 1280): string | undefined {
  if (item.BackdropImageTags?.length && item.Id) {
    return url(api, item.Id, 'Backdrop', item.BackdropImageTags[0], width, 0);
  }
  if (item.ParentBackdropImageTags?.length && item.ParentBackdropItemId) {
    return url(api, item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], width, 0);
  }
  return primaryImageUrl(api, item, width);
}

/** 16:9 thumb for an episode row: own still frame, else series backdrop. */
export function episodeThumbUrl(api: Api, episode: BaseItemDto, width = 480): string | undefined {
  if (episode.ImageTags?.Primary && episode.Id) {
    return url(api, episode.Id, 'Primary', episode.ImageTags.Primary, width);
  }
  return backdropImageUrl(api, episode, width);
}
