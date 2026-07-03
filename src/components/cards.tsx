import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { episodeCode, playedProgress } from '@/lib/format';
import { backdropImageUrl, primaryImageUrl } from '@/lib/image';

const posterPlaceholder = { backgroundColor: '#27272a' };

/** 2:3 poster card for series/movies. */
export function PosterCard({
  api,
  item,
  onPress,
}: {
  api: Api;
  item: BaseItemDto;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="w-28 active:opacity-70">
      <Image
        source={primaryImageUrl(api, item, 320)}
        style={[{ width: 112, height: 168, borderRadius: 8 }, posterPlaceholder]}
        contentFit="cover"
        transition={150}
      />
      <Text numberOfLines={2} className="mt-1.5 text-xs font-medium text-white">
        {item.Name}
      </Text>
      {item.ProductionYear != null && (
        <Text className="text-xs text-muted">{item.ProductionYear}</Text>
      )}
    </Pressable>
  );
}

function wideLabel(item: BaseItemDto): { title: string; subtitle: string } {
  if (item.Type === BaseItemKind.Episode) {
    return {
      title: item.SeriesName ?? item.Name ?? '',
      subtitle: `${episodeCode(item)} · ${item.Name ?? ''}`,
    };
  }
  return { title: item.Name ?? '', subtitle: item.ProductionYear?.toString() ?? '' };
}

/** 16:9 card with watch progress, used for Continue Watching / Next Up. */
export function WideCard({
  api,
  item,
  onPress,
}: {
  api: Api;
  item: BaseItemDto;
  onPress: () => void;
}) {
  const progress = playedProgress(item);
  const { title, subtitle } = wideLabel(item);
  return (
    <Pressable onPress={onPress} className="w-64 active:opacity-70">
      <View className="overflow-hidden rounded-lg">
        <Image
          source={backdropImageUrl(api, item, 640)}
          style={[{ width: 256, height: 144 }, posterPlaceholder]}
          contentFit="cover"
          transition={150}
        />
        {progress > 0 && (
          <View className="absolute inset-x-2 bottom-2">
            <ProgressBar value={progress} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} className="mt-1.5 text-xs font-medium text-white">
        {title}
      </Text>
      {!!subtitle && (
        <Text numberOfLines={1} className="text-xs text-muted">
          {subtitle}
        </Text>
      )}
    </Pressable>
  );
}
