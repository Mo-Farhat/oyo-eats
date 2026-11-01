import { Card, Screen, Text } from '@/components';

/** Placeholder until the Menu screens are built (next Milestone 3 slice). */
export default function Placeholder() {
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Menu
      </Text>
      <Card>
        <Text variant="muted">
          This part of the restaurant app comes in the next Milestone 3 slice.
        </Text>
      </Card>
    </Screen>
  );
}
