import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MediaRow } from '@/components/media-row';
import { Loading } from '@/components/query-state';
import { useLatestMedia, useNextUp, useResumeItems } from '@/lib/api/queries';
import { useApi, useSessionInfo } from '@/stores/auth';
import { useLocalData } from '@/stores/local-data';

function resumeTicks(item: BaseItemDto): number {
  return item.UserData?.Played ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0);
}

export default function HomeScreen() {
  const api = useApi();
  const { serverName } = useSessionInfo();
  const router = useRouter();

  const resume = useResumeItems();
  const nextUp = useNextUp();
  const latest = useLatestMedia();
  const merges = useLocalData((s) => s.merges);

  // Series merged into another page don't resurface in Recently Added.
  const latestVisible = latest.data?.filter((item) => !item.Id || !merges[item.Id]);

  const loading = resume.isLoading && nextUp.isLoading && latest.isLoading;
  const refreshing = resume.isRefetching || nextUp.isRefetching || latest.isRefetching;
  const onRefresh = () => {
    void resume.refetch();
    void nextUp.refetch();
    void latest.refetch();
  };

  const openPlayer = (item: BaseItemDto) => {
    if (!item.Id) return;
    router.push({
      pathname: '/player',
      params: { itemId: item.Id, startTicks: String(resumeTicks(item)) },
    });
  };

  const openDetail = (item: BaseItemDto) => {
    if (!item.Id) return;
    router.push({ pathname: '/item/[id]', params: { id: item.Id } });
  };

  const empty =
    !loading && !resume.data?.length && !nextUp.data?.length && !latest.data?.length;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />
      }>
      <SafeAreaView edges={['top']}>
        <View className="px-4 pb-5 pt-2">
          <Text className="text-2xl font-bold text-white">Jellyfinner</Text>
          <Text className="text-xs text-muted">{serverName}</Text>
        </View>

        {loading && <Loading />}

        <MediaRow
          api={api}
          title="Continue Watching"
          items={resume.data}
          variant="wide"
          onPressItem={openPlayer}
        />
        <MediaRow
          api={api}
          title="Next Up"
          items={nextUp.data}
          variant="wide"
          onPressItem={openPlayer}
        />
        <MediaRow
          api={api}
          title="Recently Added"
          items={latestVisible}
          variant="poster"
          onPressItem={openDetail}
        />

        {empty && (
          <View className="items-center px-8 py-16">
            <Text className="text-center text-base text-muted">
              Nothing here yet — browse your libraries from the Library tab.
            </Text>
          </View>
        )}
      </SafeAreaView>
    </ScrollView>
  );
}
