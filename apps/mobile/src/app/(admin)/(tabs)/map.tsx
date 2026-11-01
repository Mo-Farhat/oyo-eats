import { Card, Screen, Text } from '@/components';

/** Placeholder (A07, Milestone 4). */
export default function Placeholder() {
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Live Map
      </Text>
      <Card>
        <Text variant="muted">Coming in a later Milestone 4 slice.</Text>
      </Card>
    </Screen>
  );
}
