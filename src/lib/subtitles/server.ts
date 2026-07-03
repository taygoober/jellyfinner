import type { Api } from '@jellyfin/sdk';
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models';

import { parseSubtitles, type SubtitleCue } from './parse';

export type ServerSubtitleTrack = {
  index: number;
  label: string;
  language: string | null;
};

/** Text subtitle streams of a media source — the ones we can fetch as VTT. */
export function serverSubtitleTracks(
  mediaSource: MediaSourceInfo | null | undefined
): ServerSubtitleTrack[] {
  return (mediaSource?.MediaStreams ?? [])
    .filter((s) => s.Type === MediaStreamType.Subtitle && s.IsTextSubtitleStream)
    .map((s) => ({
      index: s.Index ?? 0,
      label: s.DisplayTitle ?? s.Language ?? `Track ${s.Index ?? '?'}`,
      language: s.Language ?? null,
    }));
}

export async function fetchServerSubtitle(
  api: Api,
  itemId: string,
  mediaSourceId: string,
  streamIndex: number
): Promise<SubtitleCue[]> {
  const url = `${api.basePath}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.vtt?api_key=${api.accessToken}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server subtitle request failed (${res.status})`);
  return parseSubtitles(await res.text());
}
