import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { LocationType } from '@jellyfin/sdk/lib/generated-client/models';

import { episodeCode } from '@/lib/format';

/**
 * How the big play button on a series page picks its target.
 * - smart: resume a partially-watched episode, else first unwatched, else S1E1
 * - next-unwatched: first unwatched in order (ignores partial progress)
 * - first-episode: always the first episode
 */
export type PlayButtonMode = 'smart' | 'next-unwatched' | 'first-episode';

export type PlayTargetReason = 'resume' | 'next-unwatched' | 'first-episode';

export type PlayTarget = {
  episode: BaseItemDto;
  reason: PlayTargetReason;
};

const LAST = Number.MAX_SAFE_INTEGER;

/**
 * Playback order: season number first, then the user's manual position (from
 * the Arrange mode on the series page), then episode number. Manual positions
 * are saved per season, so they never fight across seasons. Episodes the user
 * never touched keep their natural spot via the episode-number fallback.
 */
export function orderEpisodes(
  episodes: BaseItemDto[],
  manualPositions: Record<string, number> = {}
): BaseItemDto[] {
  return [...episodes].sort(
    (a, b) =>
      (a.ParentIndexNumber ?? LAST) - (b.ParentIndexNumber ?? LAST) ||
      (manualPositions[a.Id ?? ''] ?? LAST) - (manualPositions[b.Id ?? ''] ?? LAST) ||
      (a.IndexNumber ?? LAST) - (b.IndexNumber ?? LAST)
  );
}

function isReal(ep: BaseItemDto): boolean {
  // Virtual = metadata-only placeholder for a missing file; never offer to play it.
  return ep.LocationType !== LocationType.Virtual;
}

/**
 * Deterministic play-button target. Never "some random episode":
 * specials (season 0) are only considered when the series has nothing else,
 * and the caller always gets told *why* an episode was chosen so the UI can
 * label the button ("Resume S2E5", "Play S1E1", ...).
 *
 * Expects episodes already in playback order (see orderEpisodes), so manual
 * reordering automatically changes what "next unwatched" means.
 */
export function pickPlayTarget(
  orderedEpisodes: BaseItemDto[],
  mode: PlayButtonMode = 'smart'
): PlayTarget | null {
  const all = orderedEpisodes.filter(isReal);
  if (all.length === 0) return null;

  const regular = all.filter((ep) => (ep.ParentIndexNumber ?? 1) > 0);
  const pool = regular.length > 0 ? regular : all;

  if (mode === 'smart') {
    const resume = pool.find(
      (ep) => (ep.UserData?.PlaybackPositionTicks ?? 0) > 0 && !ep.UserData?.Played
    );
    if (resume) return { episode: resume, reason: 'resume' };
  }

  if (mode !== 'first-episode') {
    const next = pool.find((ep) => !ep.UserData?.Played);
    if (next) return { episode: next, reason: 'next-unwatched' };
  }

  return { episode: pool[0], reason: 'first-episode' };
}

export function playTargetLabel(target: PlayTarget): string {
  const code = episodeCode(target.episode);
  return target.reason === 'resume' ? `Resume ${code}` : `Play ${code}`;
}
