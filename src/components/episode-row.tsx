import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import type { DownloadRow } from '@/lib/downloads/db';
import { episodeCode, formatRuntime, playedProgress } from '@/lib/format';
import { episodeThumbUrl } from '@/lib/image';

function DownloadIndicator({
  download,
  onPress,
}: {
  download: DownloadRow | undefined;
  onPress: () => void;
}) {
  if (download?.status === 'downloading') {
    const pct = download.progress >= 0 ? `${Math.round(download.progress * 100)}%` : '';
    return (
      <View className="w-10 items-center">
        <ActivityIndicator size="small" color="#8b5cf6" />
        {!!pct && <Text className="mt-0.5 text-[10px] text-muted">{pct}</Text>}
      </View>
    );
  }
  const icon =
    download?.status === 'done'
      ? { name: 'arrow.down.circle.fill' as const, tint: '#4ade80' }
      : download?.status === 'failed'
        ? { name: 'exclamationmark.circle' as const, tint: '#f87171' }
        : download?.status === 'queued'
          ? { name: 'clock' as const, tint: '#a1a1aa' }
          : { name: 'arrow.down.circle' as const, tint: '#a1a1aa' };
  return (
    <Pressable onPress={onPress} hitSlop={8} className="w-10 items-center active:opacity-60">
      <SymbolView name={icon.name} size={22} tintColor={icon.tint} />
    </Pressable>
  );
}

/**
 * One episode in the series page list: thumb, code + title, runtime,
 * watched state, watch progress, version count, download state.
 * Long-press (or tap the versions badge) opens the version sheet.
 */
export function EpisodeRow({
  api,
  episode,
  download,
  onPress,
  onLongPress,
  onDownloadPress,
}: {
  api: Api;
  episode: BaseItemDto;
  download: DownloadRow | undefined;
  onPress: () => void;
  onLongPress?: () => void;
  onDownloadPress: () => void;
}) {
  const progress = playedProgress(episode);
  const watched = !!episode.UserData?.Played;
  const versionCount = episode.MediaSources?.length ?? 0;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-row items-center gap-3 px-4 py-2 active:bg-surface">
      <View className="overflow-hidden rounded-md">
        <Image
          source={episodeThumbUrl(api, episode, 480)}
          style={{ width: 128, height: 72, backgroundColor: '#27272a' }}
          contentFit="cover"
          transition={100}
        />
        {progress > 0 && !watched && (
          <View className="absolute inset-x-1 bottom-1">
            <ProgressBar value={progress} />
          </View>
        )}
      </View>

      <View className="flex-1">
        <Text numberOfLines={2} className="text-sm font-medium text-white">
          {episodeCode(episode)} · {episode.Name}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-2">
          <Text className="text-xs text-muted">{formatRuntime(episode.RunTimeTicks)}</Text>
          {versionCount > 1 && (
            <Pressable
              onPress={onLongPress}
              hitSlop={6}
              className="rounded bg-surface-high px-1.5 py-0.5 active:opacity-60">
              <Text className="text-[10px] text-accent">{versionCount} versions</Text>
            </Pressable>
          )}
          {watched && <SymbolView name="checkmark.circle.fill" size={14} tintColor="#4ade80" />}
        </View>
      </View>

      <DownloadIndicator download={download} onPress={onDownloadPress} />
    </Pressable>
  );
}
