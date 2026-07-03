import { ActivityIndicator, Text, View } from 'react-native';

export function Loading() {
  return (
    <View className="flex-1 items-center justify-center py-12">
      <ActivityIndicator color="#8b5cf6" />
    </View>
  );
}

export function ErrorView({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <View className="flex-1 items-center justify-center px-8 py-12">
      <Text className="text-center text-base text-red-400">{message}</Text>
    </View>
  );
}
