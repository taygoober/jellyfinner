/* eslint-disable react-hooks/immutability --
   Reanimated shared values are mutated from gesture worklets by design;
   these writes happen on the UI thread, never during React render. */
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ArrangeItem = { id: string; title: string; subtitle: string };

const ROW_HEIGHT = 64;
const AUTOSCROLL_ZONE = 90;
const AUTOSCROLL_STEP = 12;
const LIST_BOTTOM_PAD = 32;

function ArrangeRow({
  item,
  count,
  positions,
  scrollY,
  layoutH,
  scrollRef,
  setScrollEnabled,
  onDrop,
}: {
  item: ArrangeItem;
  count: number;
  positions: SharedValue<Record<string, number>>;
  scrollY: SharedValue<number>;
  layoutH: SharedValue<number>;
  scrollRef: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
  setScrollEnabled: (enabled: boolean) => void;
  onDrop: () => void;
}) {
  const dragging = useSharedValue(false);
  const startTop = useSharedValue(0);
  const scrollStart = useSharedValue(0);
  const top = useSharedValue((positions.value[item.id] ?? 0) * ROW_HEIGHT);

  // Rows that aren't being dragged glide to their new slot.
  useAnimatedReaction(
    () => positions.value[item.id] ?? 0,
    (index, prev) => {
      if (prev != null && index !== prev && !dragging.value) {
        top.value = withTiming(index * ROW_HEIGHT, { duration: 160 });
      }
    }
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      dragging.value = true;
      startTop.value = top.value;
      scrollStart.value = scrollY.value;
      runOnJS(setScrollEnabled)(false);
    })
    .onUpdate((e) => {
      const maxTop = (count - 1) * ROW_HEIGHT;
      // The scroll-delta term keeps the row under the finger while autoscrolling.
      const raw = startTop.value + e.translationY + (scrollY.value - scrollStart.value);
      top.value = Math.min(Math.max(raw, 0), maxTop);

      const newIndex = Math.min(Math.max(Math.round(top.value / ROW_HEIGHT), 0), count - 1);
      const current = positions.value[item.id] ?? 0;
      if (newIndex !== current) {
        const next: Record<string, number> = { ...positions.value };
        for (const key in next) {
          if (key === item.id) continue;
          const idx = next[key];
          if (newIndex > current && idx > current && idx <= newIndex) next[key] = idx - 1;
          else if (newIndex < current && idx >= newIndex && idx < current) next[key] = idx + 1;
        }
        next[item.id] = newIndex;
        positions.value = next;
      }

      const visibleY = top.value - scrollY.value;
      const maxScroll = Math.max(0, count * ROW_HEIGHT + LIST_BOTTOM_PAD - layoutH.value);
      if (visibleY < AUTOSCROLL_ZONE) {
        scrollTo(scrollRef, 0, Math.max(0, scrollY.value - AUTOSCROLL_STEP), false);
      } else if (visibleY + ROW_HEIGHT > layoutH.value - AUTOSCROLL_ZONE) {
        scrollTo(scrollRef, 0, Math.min(maxScroll, scrollY.value + AUTOSCROLL_STEP), false);
      }
    })
    .onFinalize(() => {
      dragging.value = false;
      top.value = withTiming((positions.value[item.id] ?? 0) * ROW_HEIGHT, { duration: 160 });
      runOnJS(setScrollEnabled)(true);
      runOnJS(onDrop)();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: top.value },
      { scale: withTiming(dragging.value ? 1.02 : 1, { duration: 120 }) },
    ],
    zIndex: dragging.value ? 10 : 0,
    shadowOpacity: withTiming(dragging.value ? 0.4 : 0, { duration: 120 }),
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          height: ROW_HEIGHT,
          shadowColor: '#000',
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        animatedStyle,
      ]}>
      <View className="h-full flex-row items-center gap-3 border-b border-white/5 bg-background pl-4">
        <View className="flex-1">
          <Text numberOfLines={1} className="text-sm font-medium text-white">
            {item.title}
          </Text>
          {!!item.subtitle && (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
              {item.subtitle}
            </Text>
          )}
        </View>
        <GestureDetector gesture={pan}>
          <View className="h-full w-14 items-center justify-center">
            <SymbolView name="line.3.horizontal" size={18} tintColor="#a1a1aa" />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

function ArrangeList({
  items,
  onOrderChange,
}: {
  items: ArrangeItem[];
  onOrderChange: (ids: string[]) => void;
}) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useSharedValue(0);
  const layoutH = useSharedValue(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(items.map((it, i) => [it.id, i]))
  );

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const commitOrder = () => {
    const ids = Object.entries(positions.value)
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id);
    onOrderChange(ids);
  };

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      scrollEnabled={scrollEnabled}
      onLayout={(e) => {
        layoutH.value = e.nativeEvent.layout.height;
      }}
      contentContainerStyle={{ height: items.length * ROW_HEIGHT + LIST_BOTTOM_PAD }}>
      {items.map((item) => (
        <ArrangeRow
          key={item.id}
          item={item}
          count={items.length}
          positions={positions}
          scrollY={scrollY}
          layoutH={layoutH}
          scrollRef={scrollRef}
          setScrollEnabled={setScrollEnabled}
          onDrop={commitOrder}
        />
      ))}
    </Animated.ScrollView>
  );
}

/**
 * Full-screen drag-to-reorder for one season: grab the ≡ handle and move the
 * episode wherever it belongs. Nothing is saved until Done.
 */
export function ArrangeSheet({
  visible,
  sessionKey,
  title,
  items,
  hasCustomOrder,
  onCancel,
  onReset,
  onSave,
}: {
  visible: boolean;
  /** Bump on every open so a cancelled session never leaks its order into the next. */
  sessionKey: number;
  title: string;
  items: ArrangeItem[];
  hasCustomOrder: boolean;
  onCancel: () => void;
  onReset: () => void;
  onSave: (orderedIds: string[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const orderRef = useRef<string[]>([]);

  // A fresh session starts from the incoming order; a cancelled drag from the
  // previous session must never leak into this one's Done.
  useEffect(() => {
    orderRef.current = items.map((i) => i.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      {/* RNGH needs its own root inside a Modal. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-1 bg-background">
          <View className="flex-row items-center justify-between px-4 pb-2">
            <Pressable onPress={onCancel} hitSlop={8} className="active:opacity-60">
              <Text className="text-sm text-muted">Cancel</Text>
            </Pressable>
            <Text numberOfLines={1} className="mx-3 flex-1 text-center text-base font-semibold text-white">
              {title}
            </Text>
            <Pressable
              onPress={() => onSave(orderRef.current.length ? orderRef.current : items.map((i) => i.id))}
              hitSlop={8}
              className="active:opacity-60">
              <Text className="text-sm font-semibold text-accent">Done</Text>
            </Pressable>
          </View>

          <View className="flex-row items-center justify-between px-4 pb-3">
            <Text className="text-xs text-muted">Drag the handles into playback order</Text>
            {hasCustomOrder && (
              <Pressable onPress={onReset} hitSlop={8} className="active:opacity-60">
                <Text className="text-xs font-medium text-red-400">Reset to server order</Text>
              </Pressable>
            )}
          </View>

          <ArrangeList
            key={sessionKey}
            items={items}
            onOrderChange={(ids) => {
              orderRef.current = ids;
            }}
          />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
