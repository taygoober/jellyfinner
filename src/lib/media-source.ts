import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { MediaStreamType } from '@jellyfin/sdk/lib/generated-client/models';

import { formatBytes } from '@/lib/format';

/**
 * "2160p · HEVC · 18.3 GB" — enough to pick a version at a glance.
 * The server's own name (edition, filename) rides along as the detail line.
 */
export function describeMediaSource(ms: MediaSourceInfo): { title: string; detail: string } {
  const video = ms.MediaStreams?.find((s) => s.Type === MediaStreamType.Video);
  const parts = [
    video?.Height ? `${video.Height}p` : undefined,
    video?.Codec?.toUpperCase(),
    formatBytes(ms.Size),
  ].filter(Boolean) as string[];
  const title = parts.join(' · ') || ms.Name || 'Version';
  const detail = ms.Name && ms.Name !== title ? ms.Name : '';
  return { title, detail };
}
