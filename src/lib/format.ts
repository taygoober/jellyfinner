import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';

export const TICKS_PER_SECOND = 10_000_000;

export function ticksToSeconds(ticks?: number | null): number {
  return (ticks ?? 0) / TICKS_PER_SECOND;
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}

export function formatRuntime(ticks?: number | null): string {
  const totalMinutes = Math.round(ticksToSeconds(ticks) / 60);
  if (totalMinutes <= 0) return '';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** "18.3 GB" / "540 MB", or '' when unknown. */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** "S2E5", tolerating missing numbers ("E5", "S2", ""). */
export function episodeCode(ep: {
  ParentIndexNumber?: number | null;
  IndexNumber?: number | null;
}): string {
  const season = ep.ParentIndexNumber != null ? `S${ep.ParentIndexNumber}` : '';
  const episode = ep.IndexNumber != null ? `E${ep.IndexNumber}` : '';
  return `${season}${episode}`;
}

/** Watch progress 0..1 derived from server user data. */
export function playedProgress(item: BaseItemDto): number {
  const pct = item.UserData?.PlayedPercentage;
  if (pct != null) return Math.min(Math.max(pct / 100, 0), 1);
  const position = item.UserData?.PlaybackPositionTicks ?? 0;
  const runtime = item.RunTimeTicks ?? 0;
  if (position > 0 && runtime > 0) return Math.min(position / runtime, 1);
  return 0;
}

/** "23 min left" for partially watched items, or '' when not applicable. */
export function formatTimeLeft(item: BaseItemDto): string {
  const position = item.UserData?.PlaybackPositionTicks ?? 0;
  const runtime = item.RunTimeTicks ?? 0;
  if (position <= 0 || runtime <= position) return '';
  const minutes = Math.max(1, Math.round(ticksToSeconds(runtime - position) / 60));
  return `${minutes} min left`;
}
