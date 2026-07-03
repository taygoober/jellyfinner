import type { Api } from '@jellyfin/sdk';
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArrangeSheet } from '@/components/arrange-sheet';
import { BottomSheet, SheetRow } from '@/components/bottom-sheet';
import { EpisodeRow } from '@/components/episode-row';
import { ProgressBar } from '@/components/progress-bar';
import { ErrorView, Loading } from '@/components/query-state';
import { SeasonChips } from '@/components/season-chips';
import { VersionSheet } from '@/components/version-sheet';
import { useItem, useSameNameSeries, useSeasons, useSeriesEpisodes } from '@/lib/api/queries';
import { enqueueDownloads, removeDownload, retryDownload } from '@/lib/downloads/manager';
import { orderEpisodes, pickPlayTarget, playTargetLabel } from '@/lib/episode-logic';
import { episodeCode, formatRuntime, formatTimeLeft, playedProgress } from '@/lib/format';
import { backdropImageUrl } from '@/lib/image';
import { clearEpisodeOrder, mergeSeries, saveEpisodeOrder, unmergeSeries } from '@/lib/local-data';
import { describeMediaSource } from '@/lib/media-source';
import { useApi } from '@/stores/auth';
import { useDownloads } from '@/stores/downloads';
import { useLocalData } from '@/stores/local-data';
import { useSettings } from '@/stores/settings';

const EMPTY_ORDER: Record<string, number> = {};

function resumeTicks(item: BaseItemDto): number {
  return item.UserData?.Played ? 0 : (item.UserData?.PlaybackPositionTicks ?? 0);
}

/** Group key by season *number*, so merged duplicate entries share seasons. */
function seasonKeyOf(episode: BaseItemDto): string {
  return String(episode.ParentIndexNumber ?? 'x');
}

function seasonLabelFor(
  num: number | null | undefined,
  seasons: BaseItemDto[] | undefined
): string {
  if (num == null) return 'Other';
  const serverName = seasons?.find((s) => s.IndexNumber === num)?.Name;
  if (serverName) return serverName;
  return num === 0 ? 'Specials' : `Season ${num}`;
}

function BackButton() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={8}
      style={{ top: insets.top + 8 }}
      className="absolute left-4 z-10 h-9 w-9 items-center justify-center rounded-full bg-black/60 active:bg-black/80">
      <SymbolView name="chevron.left" size={16} tintColor="#ffffff" />
    </Pressable>
  );
}

function Backdrop({ api, item }: { api: Api; item: BaseItemDto }) {
  return (
    <View>
      <Image
        source={backdropImageUrl(api, item, 1280)}
        style={{ width: '100%', height: 230, backgroundColor: '#18181b' }}
        contentFit="cover"
        transition={200}
      />
      <LinearGradient
        colors={['transparent', 'rgba(10,10,10,0.7)', '#0a0a0a']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 }}
      />
    </View>
  );
}

function MetaLine({ item }: { item: BaseItemDto }) {
  const parts = [
    item.ProductionYear?.toString(),
    item.Type === BaseItemKind.Movie ? formatRuntime(item.RunTimeTicks) : undefined,
    ...(item.Genres?.slice(0, 3) ?? []),
  ].filter(Boolean);
  return <Text className="mt-1 text-xs text-muted">{parts.join(' · ')}</Text>;
}

function PlayButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80">
      <SymbolView name="play.fill" size={16} tintColor="#ffffff" />
      <Text className="text-base font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

/**
 * Series page: labeled deterministic play button, season chips, ordered
 * episodes with manual Arrange mode, duplicate-entry merging, and a version
 * sheet on long-press.
 */
function SeriesDetail({ series }: { series: BaseItemDto }) {
  const api = useApi();
  const router = useRouter();
  const playButtonMode = useSettings((s) => s.playButtonMode);
  const merges = useLocalData((s) => s.merges);
  const orderMap = useLocalData((s) => s.episodeOrder);
  const seriesId = series.Id ?? '';
  const positions = orderMap[seriesId] ?? EMPTY_ORDER;

  const secondaryIds = useMemo(
    () =>
      Object.entries(merges)
        .filter(([, primaryId]) => primaryId === seriesId)
        .map(([secondaryId]) => secondaryId),
    [merges, seriesId]
  );

  const seasons = useSeasons(series.Id ?? undefined);
  const episodes = useSeriesEpisodes(series.Id ?? undefined, secondaryIds);
  const duplicates = useSameNameSeries(series);
  const downloads = useDownloads((s) => s.rows);

  const [selectedSeasonKey, setSelectedSeasonKey] = useState<string | undefined>();
  const [versionEpisode, setVersionEpisode] = useState<BaseItemDto | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [arrangeSession, setArrangeSession] = useState(0);

  const ordered = useMemo(
    () => orderEpisodes(episodes.data ?? [], positions),
    [episodes.data, positions]
  );

  const target = useMemo(() => pickPlayTarget(ordered, playButtonMode), [ordered, playButtonMode]);

  const chips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of ordered) {
      const key = seasonKeyOf(e);
      if (!seen.has(key)) seen.set(key, seasonLabelFor(e.ParentIndexNumber, seasons.data));
    }
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [ordered, seasons.data]);

  // Until the user picks a season, follow the play target so you land where
  // you're actually watching — not on a random season.
  const effectiveSeasonKey =
    selectedSeasonKey ?? (target ? seasonKeyOf(target.episode) : chips[0]?.key);

  const seasonEpisodes = useMemo(
    () => ordered.filter((e) => seasonKeyOf(e) === effectiveSeasonKey),
    [ordered, effectiveSeasonKey]
  );

  const hasCustomOrder = seasonEpisodes.some((e) => e.Id && positions[e.Id] != null);
  const dupCandidates = (duplicates.data ?? []).filter((d) => d.Id && !merges[d.Id]);

  const play = (episode: BaseItemDto, mediaSourceId?: string) => {
    if (!episode.Id) return;
    router.push({
      pathname: '/player',
      params: {
        itemId: episode.Id,
        startTicks: String(resumeTicks(episode)),
        ...(mediaSourceId ? { mediaSourceId } : {}),
      },
    });
  };

  const handleDownloadPress = (episode: BaseItemDto) => {
    if (!episode.Id) return;
    const row = downloads[episode.Id];
    if (!row) {
      enqueueDownloads(api, [{ item: episode }]);
    } else if (row.status === 'failed') {
      retryDownload(episode.Id);
    } else {
      Alert.alert(
        episode.Name ?? 'Download',
        row.status === 'done' ? 'Delete this download from the device?' : 'Cancel this download?',
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => removeDownload(episode.Id!) },
        ]
      );
    }
  };

  const downloadSeason = () => {
    const missing = seasonEpisodes.filter((e) => e.Id && !downloads[e.Id]);
    if (!missing.length) return;
    enqueueDownloads(
      api,
      missing.map((item) => ({ item }))
    );
  };

  const currentSeasonLabel = chips.find((c) => c.key === effectiveSeasonKey)?.label ?? 'Season';

  const arrangeItems = useMemo(
    () =>
      seasonEpisodes
        .filter((e) => !!e.Id)
        .map((e) => ({
          id: e.Id!,
          title: `${episodeCode(e)} · ${e.Name ?? ''}`,
          subtitle: formatRuntime(e.RunTimeTicks),
        })),
    [seasonEpisodes]
  );

  const openArrange = () => {
    setMoreOpen(false);
    setArrangeSession((n) => n + 1);
    setArrangeOpen(true);
  };

  const resetOrder = () => {
    Alert.alert('Reset order', 'Go back to the server’s episode order for this season?', [
      { text: 'Keep my order', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          clearEpisodeOrder(
            seriesId,
            seasonEpisodes.map((e) => e.Id ?? '').filter(Boolean)
          );
          setArrangeOpen(false);
        },
      },
    ]);
  };

  const confirmRemoveDownload = (episode: BaseItemDto) => {
    if (!episode.Id) return;
    Alert.alert(episode.Name ?? 'Download', 'Delete this download from the device?', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeDownload(episode.Id!) },
    ]);
  };

  const confirmMerge = (dup: BaseItemDto) => {
    const label = `${dup.Name}${dup.ProductionYear ? ` (${dup.ProductionYear})` : ''}`;
    Alert.alert(
      'Merge duplicate',
      `Show the episodes of “${label}” on this page and hide it from your library? Only this app is affected — the server stays untouched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', onPress: () => dup.Id && mergeSeries(dup.Id, seriesId) },
      ]
    );
  };

  const confirmUnmerge = () => {
    Alert.alert('Unmerge', 'Split the merged library entries into separate pages again?', [
      { text: 'Keep merged', style: 'cancel' },
      { text: 'Unmerge', style: 'destructive', onPress: () => unmergeSeries(seriesId) },
    ]);
  };

  return (
    <View className="flex-1 bg-background">
      <BackButton />
      <FlatList
        data={seasonEpisodes}
        keyExtractor={(e) => e.Id ?? ''}
        contentContainerStyle={{ paddingBottom: 48 }}
        ListHeaderComponent={
          <>
            <Backdrop api={api} item={series} />
            <View className="px-4">
              <Text className="text-3xl font-bold text-white">{series.Name}</Text>
              <MetaLine item={series} />
            </View>

            {episodes.isLoading ? (
              <Loading />
            ) : target ? (
              <>
                <PlayButton label={playTargetLabel(target)} onPress={() => play(target.episode)} />
                <View className="mx-4 mt-3 flex-row gap-3">
                  <Pressable
                    onPress={() => setVersionEpisode(target.episode)}
                    className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-surface py-3 active:bg-surface-high">
                    <SymbolView name="square.stack.3d.up" size={14} tintColor="#ffffff" />
                    <Text className="text-sm font-semibold text-white">
                      Versions · {episodeCode(target.episode)}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMoreOpen(true)}
                    className="w-16 items-center justify-center rounded-xl bg-surface py-3 active:bg-surface-high">
                    <SymbolView name="ellipsis" size={16} tintColor="#ffffff" />
                    {dupCandidates.length > 0 && (
                      <View className="absolute right-3 top-2 h-2 w-2 rounded-full bg-accent" />
                    )}
                  </Pressable>
                </View>
              </>
            ) : null}

            {!!series.Overview && (
              <Text numberOfLines={4} className="px-4 pt-4 text-sm leading-5 text-muted">
                {series.Overview}
              </Text>
            )}

            <View className="mt-5">
              <SeasonChips
                chips={chips}
                selectedKey={effectiveSeasonKey}
                onSelect={setSelectedSeasonKey}
              />
            </View>

            {seasonEpisodes.length > 0 && (
              <View className="mb-1 flex-row items-center justify-between px-4 py-1">
                <Text className="text-xs text-muted">
                  {seasonEpisodes.length} episodes
                  {hasCustomOrder ? ' · custom order' : ''}
                </Text>
                <Pressable
                  onPress={downloadSeason}
                  className="flex-row items-center gap-1 active:opacity-60">
                  <SymbolView name="arrow.down.circle" size={14} tintColor="#8b5cf6" />
                  <Text className="text-xs font-medium text-accent">Download season</Text>
                </Pressable>
              </View>
            )}
          </>
        }
        renderItem={({ item: episode }) => (
          <EpisodeRow
            api={api}
            episode={episode}
            download={episode.Id ? downloads[episode.Id] : undefined}
            onPress={() => play(episode)}
            onLongPress={() => setVersionEpisode(episode)}
            onDownloadPress={() => handleDownloadPress(episode)}
          />
        )}
      />

      <VersionSheet
        api={api}
        item={versionEpisode}
        download={versionEpisode?.Id ? downloads[versionEpisode.Id] : undefined}
        visible={versionEpisode != null}
        onClose={() => setVersionEpisode(null)}
        onPlay={(ms) => {
          const episode = versionEpisode;
          setVersionEpisode(null);
          if (episode) play(episode, ms.Id ?? undefined);
        }}
        onDownload={(ms) => {
          if (versionEpisode?.Id) {
            enqueueDownloads(api, [{ item: versionEpisode, mediaSource: ms }]);
          }
        }}
        onRemoveDownload={() => {
          const episode = versionEpisode;
          setVersionEpisode(null);
          if (episode) confirmRemoveDownload(episode);
        }}
      />

      <BottomSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={series.Name ?? 'Options'}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {arrangeItems.length > 1 && (
            <SheetRow
              title="Arrange episodes"
              subtitle={`Drag to set the playback order · ${currentSeasonLabel}`}
              onPress={openArrange}
            />
          )}
          {hasCustomOrder && (
            <SheetRow
              title="Reset episode order"
              subtitle={`Back to the server’s order for ${currentSeasonLabel}`}
              onPress={() => {
                setMoreOpen(false);
                resetOrder();
              }}
            />
          )}
          {dupCandidates.map((dup) => (
            <SheetRow
              key={dup.Id}
              title={`Merge “${dup.Name}${dup.ProductionYear ? ` (${dup.ProductionYear})` : ''}”`}
              subtitle="Duplicate library entry — fold its episodes into this page"
              onPress={() => {
                setMoreOpen(false);
                confirmMerge(dup);
              }}
            />
          ))}
          {secondaryIds.length > 0 && (
            <SheetRow
              title="Unmerge library entries"
              subtitle={`This page currently combines ${secondaryIds.length + 1} entries`}
              onPress={() => {
                setMoreOpen(false);
                confirmUnmerge();
              }}
            />
          )}
        </ScrollView>
      </BottomSheet>

      <ArrangeSheet
        visible={arrangeOpen}
        sessionKey={arrangeSession}
        title={`${currentSeasonLabel} · ${series.Name ?? ''}`}
        items={arrangeItems}
        hasCustomOrder={hasCustomOrder}
        onCancel={() => setArrangeOpen(false)}
        onReset={resetOrder}
        onSave={(ids) => {
          saveEpisodeOrder(seriesId, ids);
          setArrangeOpen(false);
        }}
      />
    </View>
  );
}

/** Movies (and playable one-offs): play/resume, version chips, download. */
function PlayableDetail({ item }: { item: BaseItemDto }) {
  const api = useApi();
  const router = useRouter();
  const downloads = useDownloads((s) => s.rows);
  const download = item.Id ? downloads[item.Id] : undefined;
  const progress = playedProgress(item);
  const timeLeft = formatTimeLeft(item);

  const sources = item.MediaSources ?? [];
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>();
  const selectedSource = sources.find((s) => s.Id === selectedSourceId) ?? sources[0];
  const selectedDetail = selectedSource ? describeMediaSource(selectedSource).detail : '';

  const play = () => {
    if (!item.Id) return;
    router.push({
      pathname: '/player',
      params: {
        itemId: item.Id,
        startTicks: String(resumeTicks(item)),
        ...(selectedSource?.Id ? { mediaSourceId: selectedSource.Id } : {}),
      },
    });
  };

  const handleDownload = () => {
    if (!item.Id) return;
    if (!download) {
      enqueueDownloads(api, [{ item, mediaSource: selectedSource }]);
    } else if (download.status === 'failed') {
      retryDownload(item.Id);
    } else {
      Alert.alert(
        item.Name ?? 'Download',
        download.status === 'done' ? 'Delete this download from the device?' : 'Cancel this download?',
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => removeDownload(item.Id!) },
        ]
      );
    }
  };

  const downloadLabel =
    download?.status === 'done'
      ? 'Downloaded'
      : download?.status === 'downloading'
        ? download.progress >= 0
          ? `Downloading ${Math.round(download.progress * 100)}%`
          : 'Downloading…'
        : download?.status === 'queued'
          ? 'Queued'
          : download?.status === 'failed'
            ? 'Retry download'
            : 'Download';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 48 }}>
      <BackButton />
      <Backdrop api={api} item={item} />
      <View className="px-4">
        <Text className="text-3xl font-bold text-white">{item.Name}</Text>
        <MetaLine item={item} />
        {progress > 0 && (
          <View className="mt-3 gap-1">
            <ProgressBar value={progress} />
            {!!timeLeft && <Text className="text-xs text-muted">{timeLeft}</Text>}
          </View>
        )}
      </View>

      {sources.length > 1 && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            className="mt-4">
            {sources.map((ms) => {
              const selected = ms.Id === selectedSource?.Id;
              return (
                <Pressable
                  key={ms.Id ?? describeMediaSource(ms).title}
                  onPress={() => setSelectedSourceId(ms.Id ?? undefined)}
                  className={
                    selected
                      ? 'rounded-full bg-accent px-4 py-1.5'
                      : 'rounded-full bg-surface px-4 py-1.5 active:bg-surface-high'
                  }>
                  <Text
                    className={
                      selected ? 'text-sm font-semibold text-white' : 'text-sm text-muted'
                    }>
                    {describeMediaSource(ms).title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {!!selectedDetail && (
            <Text numberOfLines={1} className="px-4 pt-2 text-xs text-muted">
              {selectedDetail}
            </Text>
          )}
        </>
      )}

      <PlayButton label={progress > 0 ? 'Resume' : 'Play'} onPress={play} />

      <Pressable
        onPress={handleDownload}
        className="mx-4 mt-3 flex-row items-center justify-center gap-2 rounded-xl bg-surface py-3.5 active:bg-surface-high">
        <SymbolView
          name={download?.status === 'done' ? 'checkmark.circle.fill' : 'arrow.down.circle'}
          size={16}
          tintColor={download?.status === 'done' ? '#4ade80' : '#ffffff'}
        />
        <Text className="text-base font-semibold text-white">{downloadLabel}</Text>
      </Pressable>

      {!!item.Overview && (
        <Text className="px-4 pt-5 text-sm leading-5 text-muted">{item.Overview}</Text>
      )}
    </ScrollView>
  );
}

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const merges = useLocalData((s) => s.merges);
  const item = useItem(id);

  // Opening a merged-away duplicate lands on the page that absorbed it.
  const redirectId =
    item.data?.Type === BaseItemKind.Series && item.data.Id ? merges[item.data.Id] : undefined;
  const primary = useItem(redirectId);

  if (item.isLoading || (redirectId && primary.isLoading)) return <Loading />;
  if (item.error != null || !item.data) return <ErrorView error={item.error} />;
  if (redirectId) {
    if (primary.error != null || !primary.data) return <ErrorView error={primary.error} />;
    return <SeriesDetail series={primary.data} />;
  }

  return item.data.Type === BaseItemKind.Series ? (
    <SeriesDetail series={item.data} />
  ) : (
    <PlayableDetail item={item.data} />
  );
}
