import { View } from 'react-native';

/** Thin watch-progress bar. `value` is 0..1. */
export function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <View className="h-1 overflow-hidden rounded-full bg-white/20">
      <View className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </View>
  );
}
