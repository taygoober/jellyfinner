import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgressBar } from '@/components/progress-bar';
import type { DownloadRow } from '@/lib/downloads/db';
import { removeDownload, retryDownload } from '@/lib/downloads/manager';
import { formatBytes } from '@/lib/format';
import { useDownloads } from '@/stores/downloads';

function statusLine(row: DownloadRow): string {
  switch (row.status) {
    case 'queued':
      return 'Queued';
    case 'downloading':
      return row.progress >= 0 ? `Downloading · ${Math.round(row.progress * 100)}%` : 'Downloading…';
    case 'failed':
      return `Failed · ${row.error ?? 'unknown error'}`;
    case 'done':
      return formatBytes(row.sizeBytes) || 'Downloaded';
  }
}

export default function DownloadsScreen() {
  const router = useRouter();
  const rows = useDownloads((s) => s.rows);

  const list = Object.values(rows).sort((a, b) => {
    const activeA = a.status === 'done' ? 1 : 0;
    const activeB = b.status === 'done' ? 1 : 0;
    return activeA - activeB || b.createdAt - a.createdAt;
  });

  const totalBytes = list.reduce(
    (sum, r) => sum + (r.status === 'done' ? (r.sizeBytes ?? 0) : 0),
    0
  );

  const confirmRemove = (row: DownloadRow) => {
    Alert.alert(
      row.name,
      row.status === 'done' ? 'Delete this download from the device?' : 'Cancel this download?',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeDownload(row.itemId) },
      ]
    );
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <View className="flex-row items-baseline justify-between px-4 pb-4 pt-2">
        <Text className="text-2xl font-bold text-white">Downloads</Text>
        {totalBytes > 0 && <Text className="text-xs text-muted">{formatBytes(totalBytes)}</Text>}
      </View>

      <FlatList
        data={list}
        keyExtractor={(row) => row.itemId}
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={
          <View className="items-center px-8 py-16">
            <SymbolView name="arrow.down.circle" size={40} tintColor="#3f3f46" />
            <Text className="mt-4 text-center text-base text-muted">
              Nothing downloaded yet. Use the download button on any episode or movie — you can
              queue a whole season at once.
            </Text>
          </View>
        }
        renderItem={({ item: row }) => (
          <Pressable
            disabled={row.status !== 'done'}
            onPress={() =>
              router.push({
                pathname: '/player',
                params: { itemId: row.itemId, local: '1', startTicks: '0' },
              })
            }
            className="mx-4 mb-3 rounded-xl bg-surface p-4 active:bg-surface-high">
            <View className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text numberOfLines={1} className="text-sm font-medium text-white">
                  {row.seriesName ? `${row.seriesName} · ${row.episodeCode ?? ''}` : row.name}
                </Text>
                {!!row.seriesName && (
                  <Text numberOfLines={1} className="text-xs text-muted">
                    {row.name}
                  </Text>
                )}
                <Text
                  className={`mt-0.5 text-xs ${row.status === 'failed' ? 'text-red-400' : 'text-muted'}`}
                  numberOfLines={1}>
                  {statusLine(row)}
                </Text>
              </View>

              {row.status === 'downloading' && <ActivityIndicator size="small" color="#8b5cf6" />}
              {row.status === 'done' && (
                <SymbolView name="play.circle.fill" size={26} tintColor="#8b5cf6" />
              )}
              {row.status === 'failed' && (
                <Pressable onPress={() => retryDownload(row.itemId)} hitSlop={8}>
                  <SymbolView name="arrow.clockwise.circle" size={24} tintColor="#8b5cf6" />
                </Pressable>
              )}
              <Pressable onPress={() => confirmRemove(row)} hitSlop={8}>
                <SymbolView name="trash" size={18} tintColor="#71717a" />
              </Pressable>
            </View>

            {row.status === 'downloading' && row.progress >= 0 && (
              <View className="mt-2.5">
                <ProgressBar value={row.progress} />
              </View>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
