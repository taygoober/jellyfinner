import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models';
import { useQuery } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { BottomSheet, SheetRow } from '@/components/bottom-sheet';
import { useItem } from '@/lib/api/queries';
import {
  addCustomSubtitle,
  deleteCustomSubtitle,
  listCustomSubtitles,
  loadCustomSubtitle,
  syncCustomSubtitle,
  type CustomSubtitle,
} from '@/lib/subtitles/custom';
import {
  isSubtitleCached,
  listCachedSubtitles,
  loadSubtitle,
  searchSubtitles,
  type OsSubtitle,
} from '@/lib/subtitles/opensubtitles';
import type { SubtitleCue } from '@/lib/subtitles/parse';
import { fetchServerSubtitle, serverSubtitleTracks } from '@/lib/subtitles/server';
import { useApi } from '@/stores/auth';
import { useSettings } from '@/stores/settings';

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted">
      {children}
    </Text>
  );
}

const CheckMark = <SymbolView name="checkmark" size={16} tintColor="#8b5cf6" />;
const Spinner = <ActivityIndicator size="small" color="#8b5cf6" />;

/**
 * Pick where subtitles come from: the Jellyfin server's own text tracks,
 * an OpenSubtitles search for this exact movie/episode, or files already
 * saved on the device (works offline).
 */
export function SubtitleSheet({
  visible,
  onClose,
  itemId,
  mediaSource,
  activeLabel,
  onSelect,
  onDisable,
}: {
  visible: boolean;
  onClose: () => void;
  itemId: string;
  mediaSource: MediaSourceInfo | null;
  activeLabel: string | null;
  onSelect: (cues: SubtitleCue[], label: string) => void;
  onDisable: () => void;
}) {
  const api = useApi();
  const osApiKey = useSettings((s) => s.osApiKey);
  const languages = useSettings((s) => s.subtitleLanguages);

  const item = useItem(visible ? itemId : undefined);
  const isEpisode = item.data?.Type === BaseItemKind.Episode;
  const series = useItem(isEpisode ? (item.data?.SeriesId ?? undefined) : undefined);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  const serverTracks = serverSubtitleTracks(mediaSource);
  const cached = useMemo(
    () => (visible ? listCachedSubtitles(itemId) : []),
    [visible, itemId]
  );
  const customSubs = useMemo(
    () => (visible ? listCustomSubtitles(itemId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev invalidates after add/sync/delete
    [visible, itemId, rev]
  );

  // Retry pending uploads whenever the sheet opens — this is what drains the
  // "queued while offline" jobs once the server is reachable again.
  useEffect(() => {
    if (!visible) return;
    const pending = listCustomSubtitles(itemId).filter((s) => !s.synced);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      let anySynced = false;
      for (const meta of pending) {
        try {
          await syncCustomSubtitle(api, itemId, meta);
          anySynced = true;
        } catch {
          // Still offline — stays queued.
        }
      }
      if (anySynced && !cancelled) setRev((r) => r + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, itemId, api]);

  const searchReady =
    !!item.data && (!isEpisode || !item.data?.SeriesId || series.isFetched);
  const osSearch = useQuery({
    queryKey: ['os-search', itemId, languages],
    enabled: visible && !!osApiKey.trim() && searchReady,
    staleTime: 10 * 60 * 1000,
    retry: 0,
    queryFn: () => {
      const dto = item.data!;
      if (isEpisode) {
        return searchSubtitles({
          parentImdbId: series.data?.ProviderIds?.Imdb,
          season: dto.ParentIndexNumber,
          episode: dto.IndexNumber,
          query: series.data?.ProviderIds?.Imdb ? undefined : dto.SeriesName,
        });
      }
      return searchSubtitles({
        imdbId: dto.ProviderIds?.Imdb,
        query: dto.ProviderIds?.Imdb ? undefined : dto.Name,
      });
    },
  });

  const cachedFileIds = new Set(cached.map((c) => c.fileId));
  const searchResults = (osSearch.data ?? []).filter((r) => !cachedFileIds.has(r.fileId));

  const run = async (key: string, task: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await task();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const pickServer = (index: number, label: string) =>
    run(`server-${index}`, async () => {
      if (!mediaSource?.Id) throw new Error('No active media source');
      onSelect(await fetchServerSubtitle(api, itemId, mediaSource.Id, index), label);
    });

  const pickOs = (sub: OsSubtitle | (typeof cached)[number]) =>
    run(`os-${sub.fileId}`, async () => {
      const label = `${sub.language.toUpperCase()} · ${sub.release}`;
      onSelect(await loadSubtitle(itemId, sub), label);
    });

  const pickCustom = (meta: CustomSubtitle) =>
    run(`custom-${meta.id}`, async () => {
      onSelect(await loadCustomSubtitle(itemId, meta), meta.label);
    });

  // Not run(): cancelling the picker must not close the sheet.
  const addFile = async () => {
    setBusyKey('custom-add');
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (res.canceled) return;
      const asset = res.assets[0];
      const { meta, cues } = await addCustomSubtitle(itemId, { uri: asset.uri, name: asset.name });
      // Best-effort immediate upload; if it fails the sheet-open sweep retries.
      void syncCustomSubtitle(api, itemId, meta).catch(() => {});
      onSelect(cues, meta.label);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const uploadCustom = async (meta: CustomSubtitle) => {
    setBusyKey(`custom-sync-${meta.id}`);
    setError(null);
    try {
      await syncCustomSubtitle(api, itemId, meta);
      setRev((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const confirmDeleteCustom = (meta: CustomSubtitle) => {
    Alert.alert(meta.label, 'Delete this subtitle file from the device?', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteCustomSubtitle(itemId, meta);
          setRev((r) => r + 1);
        },
      },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Subtitles">
      <ScrollView showsVerticalScrollIndicator={false}>
        {!!error && (
          <Text className="mb-2 rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{error}</Text>
        )}

        <SheetRow
          title="Off"
          selected={activeLabel == null}
          onPress={() => {
            onDisable();
            onClose();
          }}
          trailing={activeLabel == null ? CheckMark : undefined}
        />

        {serverTracks.length > 0 && (
          <>
            <SectionTitle>From your server</SectionTitle>
            {serverTracks.map((track) => (
              <SheetRow
                key={track.index}
                title={track.label}
                selected={activeLabel === track.label}
                onPress={() => pickServer(track.index, track.label)}
                trailing={
                  busyKey === `server-${track.index}`
                    ? Spinner
                    : activeLabel === track.label
                      ? CheckMark
                      : undefined
                }
              />
            ))}
          </>
        )}

        <SectionTitle>Your files</SectionTitle>
        {customSubs.map((s) => (
          <SheetRow
            key={s.id}
            title={s.label}
            subtitle={
              s.synced
                ? 'On this device · synced to server'
                : 'On this device · server upload pending'
            }
            selected={activeLabel === s.label}
            onPress={() => pickCustom(s)}
            onLongPress={() => confirmDeleteCustom(s)}
            trailing={
              busyKey === `custom-${s.id}` || busyKey === `custom-sync-${s.id}` ? (
                Spinner
              ) : activeLabel === s.label ? (
                CheckMark
              ) : s.synced ? (
                <SymbolView name="checkmark.icloud" size={16} tintColor="#3f3f46" />
              ) : (
                <Pressable onPress={() => uploadCustom(s)} hitSlop={8}>
                  <SymbolView name="icloud.and.arrow.up" size={16} tintColor="#8b5cf6" />
                </Pressable>
              )
            }
          />
        ))}
        <SheetRow
          title="Add subtitle file…"
          subtitle="Pick an .srt or .vtt — saved to this video, works offline"
          onPress={addFile}
          trailing={
            busyKey === 'custom-add' ? (
              Spinner
            ) : (
              <SymbolView name="plus.circle" size={18} tintColor="#8b5cf6" />
            )
          }
        />

        {cached.length > 0 && (
          <>
            <SectionTitle>Saved on this device</SectionTitle>
            {cached.map((sub) => {
              const label = `${sub.language.toUpperCase()} · ${sub.release}`;
              return (
                <SheetRow
                  key={sub.fileId}
                  title={label}
                  subtitle="Works offline"
                  selected={activeLabel === label}
                  onPress={() => pickOs(sub)}
                  trailing={
                    busyKey === `os-${sub.fileId}`
                      ? Spinner
                      : activeLabel === label
                        ? CheckMark
                        : undefined
                  }
                />
              );
            })}
          </>
        )}

        <SectionTitle>OpenSubtitles</SectionTitle>
        {!osApiKey.trim() ? (
          <Text className="pb-4 text-xs leading-5 text-muted">
            Add your OpenSubtitles API key in Settings to search here. Keys are free at
            opensubtitles.com → API consumers.
          </Text>
        ) : osSearch.isLoading ? (
          <View className="items-center py-4">{Spinner}</View>
        ) : osSearch.isError ? (
          <Text className="pb-4 text-xs text-red-400">
            {osSearch.error instanceof Error ? osSearch.error.message : 'Search failed'}
          </Text>
        ) : searchResults.length === 0 ? (
          <Text className="pb-4 text-xs text-muted">
            No results for “{languages || 'your languages'}”.
          </Text>
        ) : (
          searchResults.map((sub) => (
            <SheetRow
              key={sub.fileId}
              title={`${sub.language.toUpperCase()} · ${sub.release}`}
              subtitle={
                isSubtitleCached(itemId, sub.fileId)
                  ? 'Saved on this device'
                  : `${sub.downloads.toLocaleString()} downloads`
              }
              onPress={() => pickOs(sub)}
              trailing={busyKey === `os-${sub.fileId}` ? Spinner : undefined}
            />
          ))
        )}
      </ScrollView>
    </BottomSheet>
  );
}
