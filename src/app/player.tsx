import { useEventListener } from 'expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubtitleSheet } from '@/components/subtitle-sheet';
import { localFileUri } from '@/lib/downloads/manager';
import { secondsToTicks, ticksToSeconds } from '@/lib/format';
import {
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  resolvePlayback,
  type ResolvedPlayback,
} from '@/lib/playback';
import { activeCueText, type SubtitleCue } from '@/lib/subtitles/parse';
import { useApi, useAuth, useSessionInfo } from '@/stores/auth';

const REPORT_INTERVAL_MS = 10_000;
const OFFSET_STEPS_MS = [-500, -100, 100, 500] as const;

function offsetLabel(ms: number): string {
  const s = ms / 1000;
  return `${s > 0 ? '+' : ''}${s.toFixed(1)}s`;
}

export default function PlayerScreen() {
  const { itemId, startTicks, local, mediaSourceId } = useLocalSearchParams<{
    itemId: string;
    startTicks?: string;
    local?: string;
    mediaSourceId?: string;
  }>();
  const api = useApi();
  const { userId } = useSessionInfo();
  const deviceId = useAuth((s) => s.deviceId);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [remoteSource, setRemoteSource] = useState<VideoSource | null>(null);
  const [resolved, setResolved] = useState<ResolvedPlayback | null>(null);
  const resolvedRef = useRef<ResolvedPlayback | null>(null);
  const positionRef = useRef(ticksToSeconds(Number(startTicks ?? '0')));
  const lastReportRef = useRef(0);

  // Subtitles are our own overlay (expo-video can't sideload external tracks),
  // which is exactly what makes a user-adjustable sync offset possible.
  const [cues, setCues] = useState<SubtitleCue[] | null>(null);
  const [subLabel, setSubLabel] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  const startSeconds = ticksToSeconds(Number(startTicks ?? '0'));

  // Downloaded files play straight from disk — no server round-trip.
  const localSource = useMemo<VideoSource | null>(() => {
    if (local !== '1') return null;
    const uri = localFileUri(itemId);
    return uri ? { uri } : null;
  }, [local, itemId]);
  const localMissing = local === '1' && !localSource;

  const source = localSource ?? remoteSource;

  const player = useVideoPlayer(source, (p) => {
    // 250 ms ticks keep the subtitle overlay in step; progress reports throttle themselves.
    p.timeUpdateEventInterval = 0.25;
    if (startSeconds > 5) p.currentTime = startSeconds;
    p.play();
  });

  useEffect(() => {
    if (local === '1') return;
    let cancelled = false;
    (async () => {
      try {
        const result = await resolvePlayback(api, {
          itemId,
          userId,
          deviceId: deviceId ?? 'unknown-device',
          mediaSourceId: mediaSourceId || undefined,
        });
        if (cancelled) return;
        resolvedRef.current = result;
        setResolved(result);
        setRemoteSource({ uri: result.url });
        void reportPlaybackStart(api, {
          itemId,
          mediaSourceId: result.mediaSource.Id,
          playSessionId: result.playSessionId,
          positionTicks: secondsToTicks(positionRef.current),
          playMethod: result.playMethod,
        }).catch(() => {});
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Playback failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, deviceId, itemId, local, mediaSourceId, userId]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    positionRef.current = currentTime;
    if (cues) setNowMs(currentTime * 1000);
    const current = resolvedRef.current;
    if (!current) return;
    const now = Date.now();
    if (now - lastReportRef.current >= REPORT_INTERVAL_MS) {
      lastReportRef.current = now;
      void reportPlaybackProgress(api, {
        itemId,
        mediaSourceId: current.mediaSource.Id,
        playSessionId: current.playSessionId,
        positionTicks: secondsToTicks(currentTime),
        playMethod: current.playMethod,
        isPaused: !player.playing,
      }).catch(() => {});
    }
  });

  useEventListener(player, 'statusChange', ({ status, error: playerError }) => {
    if (status === 'readyToPlay') setReady(true);
    if (status === 'error') setError(playerError?.message ?? 'Playback error');
  });

  // Tell the server we stopped, so Continue Watching stays accurate.
  useEffect(() => {
    return () => {
      const current = resolvedRef.current;
      if (current) {
        void reportPlaybackStopped(api, {
          itemId,
          mediaSourceId: current.mediaSource.Id,
          playSessionId: current.playSessionId,
          positionTicks: secondsToTicks(positionRef.current),
          playMethod: current.playMethod,
        }).catch(() => {});
      }
    };
  }, [api, itemId]);

  // Positive offset shows subtitles later — bump "+" when they appear too early.
  const subtitleText = useMemo(
    () => (cues ? activeCueText(cues, nowMs - offsetMs) : ''),
    [cues, nowMs, offsetMs]
  );

  const errorMessage = localMissing ? 'This download is no longer on the device' : error;
  const showSpinner = !errorMessage && !ready;

  return (
    <View className="flex-1 bg-black">
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" allowsPictureInPicture />

      {!!subtitleText && (
        <View
          pointerEvents="none"
          style={{ bottom: insets.bottom + 28 }}
          className="absolute inset-x-0 items-center px-6">
          <Text
            className="rounded-lg bg-black/70 px-3 py-1.5 text-center text-base font-medium text-white"
            style={{ lineHeight: 24 }}>
            {subtitleText}
          </Text>
        </View>
      )}

      {showSpinner && (
        <View className="absolute inset-0 items-center justify-center">
          <ActivityIndicator size="large" color="#8b5cf6" />
        </View>
      )}

      {errorMessage && (
        <View className="absolute inset-0 items-center justify-center bg-black/80 px-8">
          <SymbolView name="exclamationmark.triangle" size={32} tintColor="#f87171" />
          <Text className="mt-4 text-center text-base text-white">{errorMessage}</Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-6 rounded-xl bg-surface px-6 py-3 active:bg-surface-high">
            <Text className="text-base font-medium text-white">Go back</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        style={{ top: insets.top + 8 }}
        className="absolute left-4 h-9 w-9 items-center justify-center rounded-full bg-black/60 active:bg-black/80">
        <SymbolView name="xmark" size={15} tintColor="#ffffff" />
      </Pressable>

      <View style={{ top: insets.top + 8 }} className="absolute right-4 items-end gap-2">
        <Pressable
          onPress={() => setSheetOpen(true)}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center rounded-full bg-black/60 active:bg-black/80">
          <SymbolView
            name={subLabel ? 'captions.bubble.fill' : 'captions.bubble'}
            size={16}
            tintColor={subLabel ? '#8b5cf6' : '#ffffff'}
          />
        </Pressable>

        {!!subLabel && (
          <Pressable
            onPress={() => setOffsetOpen((v) => !v)}
            hitSlop={8}
            className="rounded-full bg-black/60 px-3 py-1.5 active:bg-black/80">
            <Text className="text-xs font-medium text-white">{offsetLabel(offsetMs)}</Text>
          </Pressable>
        )}

        {offsetOpen && !!subLabel && (
          <View className="flex-row items-center gap-1.5 rounded-full bg-black/70 p-1.5">
            {OFFSET_STEPS_MS.slice(0, 2).map((step) => (
              <Pressable
                key={step}
                onPress={() => setOffsetMs((v) => v + step)}
                className="rounded-full bg-white/10 px-2.5 py-1.5 active:bg-white/25">
                <Text className="text-xs font-medium text-white">{step / 1000}s</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setOffsetMs(0)}
              className="rounded-full px-2 py-1.5 active:opacity-60">
              <SymbolView name="arrow.counterclockwise" size={13} tintColor="#a1a1aa" />
            </Pressable>
            {OFFSET_STEPS_MS.slice(2).map((step) => (
              <Pressable
                key={step}
                onPress={() => setOffsetMs((v) => v + step)}
                className="rounded-full bg-white/10 px-2.5 py-1.5 active:bg-white/25">
                <Text className="text-xs font-medium text-white">+{step / 1000}s</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <SubtitleSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        itemId={itemId}
        mediaSource={local === '1' ? null : (resolved?.mediaSource ?? null)}
        activeLabel={subLabel}
        onSelect={(newCues, label) => {
          setCues(newCues);
          setSubLabel(label);
        }}
        onDisable={() => {
          setCues(null);
          setSubLabel(null);
          setOffsetOpen(false);
        }}
      />
    </View>
  );
}
