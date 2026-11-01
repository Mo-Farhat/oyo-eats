import { Button, Card, Screen, Text } from '@/components';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';

/** T12 (first pass): account and sign out. Hours, staff and reviews follow. */
export default function More() {
  const account = useSession((s) => s.session?.account);
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        More
      </Text>
      <Card>
        <Text variant="strong">{account?.displayName}</Text>
        <Text variant="muted">{account?.role === 'restaurant_owner' ? 'Owner' : 'Staff'}</Text>
      </Card>
      <Button variant="secondary" label="Sign Out" onPress={() => void signOut()} />
    </Screen>
  );
}
