import type { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Minimal dependency-free bottom sheet: dim backdrop, dark panel, grab handle.
 * Content taller than 75% of the screen should bring its own ScrollView.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} />
        <View
          style={{ paddingBottom: insets.bottom + 12, maxHeight: '75%' }}
          className="rounded-t-2xl bg-surface px-4 pt-3">
          <View className="mb-3 h-1 w-10 self-center rounded-full bg-white/20" />
          {!!title && (
            <Text numberOfLines={1} className="mb-2 text-base font-semibold text-white">
              {title}
            </Text>
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Uniform row for sheets: label block + optional trailing accessory. */
export function SheetRow({
  title,
  subtitle,
  trailing,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`mb-2 flex-row items-center gap-3 rounded-xl p-3.5 active:bg-surface-high ${
        selected ? 'bg-surface-high' : 'bg-white/5'
      }`}>
      <View className="flex-1">
        <Text numberOfLines={2} className="text-sm font-medium text-white">
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={1} className="mt-0.5 text-xs text-muted">
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}
