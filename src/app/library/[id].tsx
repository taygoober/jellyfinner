import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList } from 'react-native';

import { PosterCard } from '@/components/cards';
import { ErrorView, Loading } from '@/components/query-state';
import { useLibraryItems } from '@/lib/api/queries';
import { useApi } from '@/stores/auth';
import { useLocalData } from '@/stores/local-data';

export default function LibraryDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const api = useApi();
  const router = useRouter();
  const items = useLibraryItems(id);
  const merges = useLocalData((s) => s.merges);

  // Entries merged into another page stay hidden here.
  const visibleItems = useMemo(
    () => (items.data ?? []).filter((item) => !item.Id || !merges[item.Id]),
    [items.data, merges]
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: name ?? 'Library' }} />
      {items.isLoading && <Loading />}
      {items.error != null && <ErrorView error={items.error} />}
      <FlatList
        className="flex-1 bg-background"
        data={visibleItems}
        keyExtractor={(item) => item.Id ?? ''}
        numColumns={3}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 16, paddingVertical: 16, paddingBottom: 48 }}
        renderItem={({ item }) => (
          <PosterCard
            api={api}
            item={item}
            onPress={() =>
              item.Id && router.push({ pathname: '/item/[id]', params: { id: item.Id } })
            }
          />
        )}
      />
    </>
  );
}
