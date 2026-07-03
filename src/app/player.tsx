/* eslint-disable react-hooks/immutability, react-hooks/refs --
   Two intentional imperative patterns the React Compiler lint flags as false
   positives here: (1) expo-video's player (from useVideoPlayer) is a mutable
   handle — seeking is `player.currentTime = x` and play/pause mutate it;
   (2) the scrubber keeps a single stable PanResponder that reads live values
   through refs at gesture time (recreating it per render would break an
   in-progress drag). Refs are only written in effects and read in handlers. */
import { useEventListener } from 'expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, Text, View } from 'react-native';
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
const CONTROLS_TIMEOUT_MS = 3500;

function offsetLabel(ms: number): string {
  const s = ms / 1000;
  return `${s > 0 ? '+' : ''}${s.toFixed(1)}s`;
}

function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Draggable seek bar. Reports live drag position, and the final target on release. */
function Scrubber({
  position,
  duration,
  onScrubStart,
  onScrub,
  onSeek,
}: {
  position: number;
  duration: number;
  onScrubStart: () => void;
  onScrub: (seconds: number) => void;
  onSeek: (seconds: number) => void;
}) {
  const widthRef = useRef(0);
  // Refs so the once-created PanResponder never reads a stale width/duration/callback.
  const durationRef = useRef(duration);
  const startRef = useRef(onScrubStart);
  const scrubRef = useRef(onScrub);
  const seekRef = useRef(onSeek);
  const dragValRef = useRef(0);
  const [dragFrac, setDragFrac] = useState<number | null>(null);

  // Refs are updated in an effect, never during render.
  useEffect(() => {
    durationRef.current = duration;
    startRef.current = onScrubStart;
    scrubRef.current = onScrub;
    seekRef.current = onSeek;
  });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          startRef.current();
          const f = clamp01(e.nativeEvent.locationX / (widthRef.current || 1));
          dragValRef.current = f;
          setDragFrac(f);
          scrubRef.current(f * durationRef.current);
        },
        onPanResponderMove: (e) => {
          const f = clamp01(e.nativeEvent.locationX / (widthRef.current || 1));
          dragValRef.current = f;
          setDragFrac(f);
          scrubRef.current(f * durationRef.current);
        },
        onPanResponderRelease: () => {
          seekRef.current(dragValRef.current * durationRef.current);
          setDragFrac(null);
        },
        onPanResponderTerminate: () => setDragFrac(null),
      }),
    []
  );

  const frac = dragFrac ?? (duration > 0 ? clamp01(position / duration) : 0);

  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      className="justify-center"
      style={{ height: 24 }}>
      <View className="h-1 overflow-hidden rounded-full bg-white/25">
        <View className="h-full rounded-full bg-accent" style={{ width: `${frac * 100}%` }} />
      </View>
      <View
        style={{ position: 'absolute', left: `${frac * 100}%`, marginLeft: -7 }}
        className="h-3.5 w-3.5 rounded-full bg-accent"
      />
    </View>
  );
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

  // Custom transport state (native controls are disabled below).
  const startSeconds = ticksToSeconds(Number(startTicks ?? '0'));
  const [isPlaying, setIsPlaying] = useState(true);
  const [position, setPosition] = useState(startSeconds);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPos, setScrubPos] = useState(startSeconds);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interaction, setInteraction] = useState(0);
  const scrubbingRef = useRef(false);
  useEffect(() => {
    scrubbingRef.current = scrubbing;
  }, [scrubbing]);

  // Downloaded files play straight from disk — no server round-trip.
  const localSource = useMemo<VideoSource | null>(() => {
    if (local !== '1') return null;
    const uri = localFileUri(itemId);
    return uri ? { uri } : null;
  }, [local, itemId]);
  const localMissing = local === '1' && !localSource;

  const source = localSource ?? remoteSource;

  const player = useVideoPlayer(source, (p) => {
    // 250 ms ticks keep the subtitle overlay and scrubber in step; reports throttle themselves.
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
    if (!scrubbingRef.current) setPosition(currentTime);
    const d = player.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
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

  useEventListener(player, 'playingChange', ({ isPlaying: playing }) => setIsPlaying(playing));

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

  // Auto-hide the controls a few seconds after the last interaction — but only
  // while actually playing and not mid-scrub or mid-menu.
  useEffect(() => {
    if (!controlsVisible || !isPlaying || scrubbing || offsetOpen || sheetOpen) return;
    const t = setTimeout(() => setControlsVisible(false), CONTROLS_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [controlsVisible, isPlaying, scrubbing, offsetOpen, sheetOpen, interaction]);

  const bump = () => {
    setControlsVisible(true);
    setInteraction((n) => n + 1);
  };
  const toggleControls = () => {
    if (controlsVisible) setControlsVisible(false);
    else bump();
  };
  const togglePlay = () => {
    if (player.playing) player.pause();
    else player.play();
    bump();
  };
  const skip = (delta: number) => {
    const max = duration || player.duration || 0;
    const next = (player.currentTime ?? position) + delta;
    const clamped = Math.max(0, max > 0 ? Math.min(next, max) : next);
    player.currentTime = clamped;
    positionRef.current = clamped;
    setPosition(clamped);
    bump();
  };
  const onSeek = (sec: number) => {
    player.currentTime = sec;
    positionRef.current = sec;
    setPosition(sec);
    setScrubbing(false);
    bump();
  };

  // Positive offset shows subtitles later — bump "+" when they appear too early.
  const subtitleText = useMemo(
    () => (cues ? activeCueText(cues, position * 1000 - offsetMs) : ''),
    [cues, position, offsetMs]
  );

  const errorMessage = localMissing ? 'This download is no longer on the device' : error;
  const showSpinner = !errorMessage && !ready;
  const showControls = controlsVisible && ready && !errorMessage;
  const elapsed = scrubbing ? scrubPos : position;

  return (
    <View className="flex-1 bg-black">
      <VideoView
        player={player}
        style={{ flex: 1 }}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture
      />

      {/* Tap layer: toggles the controls. Sits above the video, below the controls. */}
      <Pressable className="absolute inset-0" onPress={toggleControls} />

      {!!subtitleText && (
        <View
          pointerEvents="none"
          style={{ bottom: insets.bottom + (showControls ? 92 : 28) }}
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

      {showControls && (
        <View pointerEvents="box-none" className="absolute inset-0">
          {/* Top row: close on the left, subtitles + offset on the right. */}
          <View
            pointerEvents="box-none"
            style={{ top: insets.top + 8 }}
            className="absolute left-4 right-4 flex-row items-start justify-between">
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full bg-black/60 active:bg-black/80">
              <SymbolView name="xmark" size={15} tintColor="#ffffff" />
            </Pressable>

            <View pointerEvents="box-none" className="items-end gap-2">
              <Pressable
                onPress={() => {
                  setSheetOpen(true);
                  bump();
                }}
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
                  onPress={() => {
                    setOffsetOpen((v) => !v);
                    bump();
                  }}
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
                      onPress={() => {
                        setOffsetMs((v) => v + step);
                        bump();
                      }}
                      className="rounded-full bg-white/10 px-2.5 py-1.5 active:bg-white/25">
                      <Text className="text-xs font-medium text-white">{step / 1000}s</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => {
                      setOffsetMs(0);
                      bump();
                    }}
                    className="rounded-full px-2 py-1.5 active:opacity-60">
                    <SymbolView name="arrow.counterclockwise" size={13} tintColor="#a1a1aa" />
                  </Pressable>
                  {OFFSET_STEPS_MS.slice(2).map((step) => (
                    <Pressable
                      key={step}
                      onPress={() => {
                        setOffsetMs((v) => v + step);
                        bump();
                      }}
                      className="rounded-full bg-white/10 px-2.5 py-1.5 active:bg-white/25">
                      <Text className="text-xs font-medium text-white">+{step / 1000}s</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Center transport: skip back, play/pause, skip forward. */}
          <View
            pointerEvents="box-none"
            className="absolute inset-0 flex-row items-center justify-center gap-12">
            <Pressable onPress={() => skip(-10)} hitSlop={12} className="active:opacity-60">
              <SymbolView name="gobackward.10" size={34} tintColor="#ffffff" />
            </Pressable>
            <Pressable
              onPress={togglePlay}
              hitSlop={12}
              className="h-16 w-16 items-center justify-center rounded-full bg-black/50 active:bg-black/70">
              <SymbolView name={isPlaying ? 'pause.fill' : 'play.fill'} size={30} tintColor="#ffffff" />
            </Pressable>
            <Pressable onPress={() => skip(10)} hitSlop={12} className="active:opacity-60">
              <SymbolView name="goforward.10" size={34} tintColor="#ffffff" />
            </Pressable>
          </View>

          {/* Bottom: scrubber + elapsed/total time. */}
          <View
            pointerEvents="box-none"
            style={{ bottom: insets.bottom + 12 }}
            className="absolute left-4 right-4">
            <Scrubber
              position={position}
              duration={duration}
              onScrubStart={() => {
                setScrubbing(true);
                bump();
              }}
              onScrub={(sec) => {
                setScrubPos(sec);
                bump();
              }}
              onSeek={onSeek}
            />
            <View className="mt-1 flex-row justify-between">
              <Text className="text-xs font-medium text-white">{formatClock(elapsed)}</Text>
              <Text className="text-xs font-medium text-white/70">{formatClock(duration)}</Text>
            </View>
          </View>
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
