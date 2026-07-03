import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto, MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { BottomSheet, SheetRow } from '@/components/bottom-sheet';
import type { DownloadRow } from '@/lib/downloads/db';
import { episodeCode, formatRuntime } from '@/lib/format';
import { episodeThumbUrl } from '@/lib/image';
import { describeMediaSource } from '@/lib/media-source';

/**
 * Every version of an episode/movie, one tap from the row that shows it — no
 * "More → Versions" burial. Header shows the episode itself (thumb, name,
 * length); each version row shows quality, its own length, and whether that
 * exact version is on the device. Tap a version to play it, the arrow to
 * download it, the green check to remove the download.
 */
export function VersionSheet({
  api,
  item,
  download,
  visible,
  onClose,
  onPlay,
  onDownload,
  onRemoveDownload,
}: {
  api: Api;
  item: BaseItemDto | null;
  download: DownloadRow | undefined;
  visible: boolean;
  onClose: () => void;
  onPlay: (mediaSource: MediaSourceInfo) => void;
  onDownload: (mediaSource: MediaSourceInfo) => void;
  onRemoveDownload: () => void;
}) {
  const sources = item?.MediaSources ?? [];
  const metaLine = item
    ? [episodeCode(item), formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' · ')
    : '';

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {!!item && (
        <View className="mb-3 flex-row items-center gap-3">
          <Image
            source={episodeThumbUrl(api, item, 320)}
            style={{ width: 96, height: 54, borderRadius: 6, backgroundColor: '#27272a' }}
            contentFit="cover"
            transition={100}
          />
          <View className="flex-1">
            <Text numberOfLines={2} className="text-base font-semibold text-white">
              {item.Name}
            </Text>
            {!!metaLine && <Text className="mt-0.5 text-xs text-muted">{metaLine}</Text>}
          </View>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {sources.map((ms) => {
          const { title, detail } = describeMediaSource(ms);
          const isThisVersion = !!download && download.mediaSourceId === (ms.Id ?? '');
          const downloaded = isThisVersion && download.status === 'done';
          const inFlight =
            isThisVersion && (download.status === 'downloading' || download.status === 'queued');

          const subtitleParts = [
            formatRuntime(ms.RunTimeTicks ?? item?.RunTimeTicks),
            detail,
            downloaded ? 'Downloaded' : inFlight ? 'Downloading…' : '',
          ].filter(Boolean);

          return (
            <SheetRow
              key={ms.Id ?? title}
              title={title}
              subtitle={subtitleParts.join(' · ') || undefined}
              selected={downloaded}
              onPress={() => onPlay(ms)}
              trailing={
                inFlight ? (
                  <ActivityIndicator size="small" color="#8b5cf6" />
                ) : downloaded ? (
                  <Pressable
                    hitSlop={8}
                    onPress={onRemoveDownload}
                    className="h-9 w-9 items-center justify-center rounded-full bg-surface-high active:opacity-60">
                    <SymbolView name="checkmark.circle.fill" size={18} tintColor="#4ade80" />
                  </Pressable>
                ) : (
                  <Pressable
                    hitSlop={8}
                    onPress={() => onDownload(ms)}
                    className="h-9 w-9 items-center justify-center rounded-full bg-surface-high active:opacity-60">
                    <SymbolView name="arrow.down" size={15} tintColor="#8b5cf6" />
                  </Pressable>
                )
              }
            />
          );
        })}
        {sources.length === 0 && (
          <Text className="py-6 text-center text-sm text-muted">
            The server reports no playable versions for this item.
          </Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}
