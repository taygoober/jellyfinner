import { Pressable, ScrollView, Text } from 'react-native';

export type SeasonChip = { key: string; label: string };

/**
 * Season selector. Chips are derived from the (possibly merged) episode list
 * itself, keyed by season number — so two library entries of the same show
 * share one "Season 1" chip after merging.
 */
export function SeasonChips({
  chips,
  selectedKey,
  onSelect,
}: {
  chips: SeasonChip[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
}) {
  if (chips.length <= 1) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      className="mb-3">
      {chips.map((chip) => {
        const selected = chip.key === selectedKey;
        return (
          <Pressable
            key={chip.key}
            onPress={() => onSelect(chip.key)}
            className={
              selected
                ? 'rounded-full bg-accent px-4 py-1.5'
                : 'rounded-full bg-surface px-4 py-1.5 active:bg-surface-high'
            }>
            <Text className={selected ? 'text-sm font-semibold text-white' : 'text-sm text-muted'}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
