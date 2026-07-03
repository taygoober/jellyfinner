import type { Api } from '@jellyfin/sdk';
import type {
  DeviceProfile,
  MediaSourceInfo,
} from '@jellyfin/sdk/lib/generated-client/models';
import {
  DlnaProfileType,
  EncodingContext,
  MediaStreamProtocol,
  PlayMethod,
  SubtitleDeliveryMethod,
} from '@jellyfin/sdk/lib/generated-client/models';
import { getMediaInfoApi } from '@jellyfin/sdk/lib/utils/api/media-info-api';
import { getPlaystateApi } from '@jellyfin/sdk/lib/utils/api/playstate-api';

const MAX_BITRATE = 100_000_000;

/** What AVPlayer (expo-video) can direct-play; everything else gets an HLS transcode. */
const DEVICE_PROFILE: DeviceProfile = {
  Name: 'Jellyfinner iOS',
  MaxStreamingBitrate: MAX_BITRATE,
  DirectPlayProfiles: [
    {
      Container: 'mp4,m4v,mov',
      Type: DlnaProfileType.Video,
      VideoCodec: 'h264,hevc',
      AudioCodec: 'aac,mp3,ac3,eac3,alac,flac',
    },
  ],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: DlnaProfileType.Video,
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      Context: EncodingContext.Streaming,
      Protocol: MediaStreamProtocol.Hls,
      MaxAudioChannels: '6',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
  ],
  SubtitleProfiles: [
    { Format: 'vtt', Method: SubtitleDeliveryMethod.Hls },
    { Format: 'vtt', Method: SubtitleDeliveryMethod.External },
  ],
};

export type ResolvedPlayback = {
  url: string;
  playMethod: PlayMethod;
  mediaSource: MediaSourceInfo;
  playSessionId: string | null;
};

export async function resolvePlayback(
  api: Api,
  opts: {
    itemId: string;
    userId: string;
    deviceId: string;
    mediaSourceId?: string;
    startTicks?: number;
  }
): Promise<ResolvedPlayback> {
  const res = await getMediaInfoApi(api).getPostedPlaybackInfo({
    itemId: opts.itemId,
    playbackInfoDto: {
      UserId: opts.userId,
      DeviceProfile: DEVICE_PROFILE,
      MediaSourceId: opts.mediaSourceId,
      StartTimeTicks: opts.startTicks,
      MaxStreamingBitrate: MAX_BITRATE,
      AutoOpenLiveStream: true,
    },
  });

  const info = res.data;
  const sources = info.MediaSources ?? [];
  const mediaSource =
    sources.find((s) => s.Id === opts.mediaSourceId) ?? sources[0];
  if (!mediaSource) throw new Error('Server offered no playable media source');
  const playSessionId = info.PlaySessionId ?? null;

  if (mediaSource.SupportsDirectPlay || mediaSource.SupportsDirectStream) {
    const container = mediaSource.Container ?? 'mp4';
    const params = new URLSearchParams({
      static: 'true',
      mediaSourceId: mediaSource.Id ?? opts.itemId,
      deviceId: opts.deviceId,
      api_key: api.accessToken,
    });
    if (playSessionId) params.set('playSessionId', playSessionId);
    return {
      url: `${api.basePath}/Videos/${opts.itemId}/stream.${container}?${params.toString()}`,
      playMethod: PlayMethod.DirectPlay,
      mediaSource,
      playSessionId,
    };
  }

  if (mediaSource.TranscodingUrl) {
    const url = mediaSource.TranscodingUrl.startsWith('http')
      ? mediaSource.TranscodingUrl
      : `${api.basePath}${mediaSource.TranscodingUrl}`;
    return { url, playMethod: PlayMethod.Transcode, mediaSource, playSessionId };
  }

  throw new Error('Server did not offer a playable stream for this item');
}

type ReportArgs = {
  itemId: string;
  mediaSourceId?: string | null;
  playSessionId?: string | null;
  positionTicks: number;
  playMethod: PlayMethod;
};

export async function reportPlaybackStart(api: Api, args: ReportArgs): Promise<void> {
  await getPlaystateApi(api).reportPlaybackStart({
    playbackStartInfo: {
      ItemId: args.itemId,
      MediaSourceId: args.mediaSourceId ?? undefined,
      PlaySessionId: args.playSessionId ?? undefined,
      PositionTicks: args.positionTicks,
      PlayMethod: args.playMethod,
      CanSeek: true,
    },
  });
}

export async function reportPlaybackProgress(
  api: Api,
  args: ReportArgs & { isPaused: boolean }
): Promise<void> {
  await getPlaystateApi(api).reportPlaybackProgress({
    playbackProgressInfo: {
      ItemId: args.itemId,
      MediaSourceId: args.mediaSourceId ?? undefined,
      PlaySessionId: args.playSessionId ?? undefined,
      PositionTicks: args.positionTicks,
      PlayMethod: args.playMethod,
      IsPaused: args.isPaused,
      CanSeek: true,
    },
  });
}

export async function reportPlaybackStopped(api: Api, args: ReportArgs): Promise<void> {
  await getPlaystateApi(api).reportPlaybackStopped({
    playbackStopInfo: {
      ItemId: args.itemId,
      MediaSourceId: args.mediaSourceId ?? undefined,
      PlaySessionId: args.playSessionId ?? undefined,
      PositionTicks: args.positionTicks,
    },
  });
}
