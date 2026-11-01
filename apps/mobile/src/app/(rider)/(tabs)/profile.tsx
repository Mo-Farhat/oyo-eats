import { Button, Card, Screen, Text } from '@/components';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';

/** R13 (first pass): account and sign out. */
export default function RiderProfile() {
  const account = useSession((s) => s.session?.account);
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Profile
      </Text>
      <Card>
        <Text variant="strong">{account?.displayName}</Text>
        <Text variant="muted">Rider</Text>
      </Card>
      <Button variant="secondary" label="Sign Out" onPress={() => void signOut()} />
    </Screen>
  );
}
