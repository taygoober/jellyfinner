import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { FlatList, Text, View } from 'react-native';

import { PosterCard, WideCard } from '@/components/cards';

/** Horizontal section on the home screen. Renders nothing when empty. */
export function MediaRow({
  api,
  title,
  items,
  variant,
  onPressItem,
}: {
  api: Api;
  title: string;
  items: BaseItemDto[] | undefined;
  variant: 'poster' | 'wide';
  onPressItem: (item: BaseItemDto) => void;
}) {
  if (!items?.length) return null;
  return (
    <View className="mb-6">
      <Text className="mb-3 px-4 text-lg font-semibold text-white">{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.Id ?? ''}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item }) =>
          variant === 'poster' ? (
            <PosterCard api={api} item={item} onPress={() => onPressItem(item)} />
          ) : (
            <WideCard api={api} item={item} onPress={() => onPressItem(item)} />
          )
        }
      />
    </View>
  );
}
