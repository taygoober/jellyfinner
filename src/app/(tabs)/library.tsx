import { CollectionType } from '@jellyfin/sdk/lib/generated-client/models';
import { useRouter } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { FlatList, Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorView, Loading } from '@/components/query-state';
import { useUserViews } from '@/lib/api/queries';

function viewIcon(collectionType?: CollectionType | null): SFSymbol {
  switch (collectionType) {
    case CollectionType.Tvshows:
      return 'tv';
    case CollectionType.Movies:
      return 'film';
    case CollectionType.Music:
      return 'music.note';
    default:
      return 'folder.fill';
  }
}

export default function LibraryScreen() {
  const router = useRouter();
  const views = useUserViews();

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <Text className="px-4 pb-4 pt-2 text-2xl font-bold text-white">Library</Text>
      {views.isLoading && <Loading />}
      {views.error != null && <ErrorView error={views.error} />}
      <FlatList
        data={views.data ?? []}
        keyExtractor={(view) => view.Id ?? ''}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item: view }) => (
          <Pressable
            onPress={() =>
              view.Id &&
              router.push({
                pathname: '/library/[id]',
                params: { id: view.Id, name: view.Name ?? 'Library' },
              })
            }
            className="mx-4 mb-3 flex-row items-center gap-4 rounded-xl bg-surface p-4 active:bg-surface-high">
            <SymbolView name={viewIcon(view.CollectionType)} size={24} tintColor="#8b5cf6" />
            <Text className="flex-1 text-base font-medium text-white">{view.Name}</Text>
            <SymbolView name="chevron.right" size={14} tintColor="#52525b" />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
