import { Button, Card, LinkRow, Screen, Text } from '@/components';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';
import { useNotifications } from '@/notifications/queries';
import { useMenu } from '@/restaurant/queries';

/** T12 (second pass): hours, change requests, account and sign out. Staff and reviews follow. */
export default function More() {
  const account = useSession((s) => s.session?.account);
  const owner = account?.role === 'restaurant_owner';
  const menu = useMenu();
  const unread = useNotifications().data?.unread ?? 0;
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        More
      </Text>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <LinkRow
          icon="bell"
          label="Notifications"
          hint="New orders and order updates"
          count={unread}
          href="/kitchen-inbox"
        />
        <LinkRow
          icon="home"
          label="Store Hours"
          hint="Pause, weekly hours, holidays"
          href="/hours"
        />
        <LinkRow
          icon="list"
          label="Change Requests"
          hint="Menu changes waiting for Oyo Eats"
          count={menu.data?.pendingRequests}
          href="/requests"
        />
        <LinkRow
          icon="star"
          label="Reviews"
          hint="Ratings and your replies"
          href="/kitchen-reviews"
        />
        <LinkRow
          icon="list"
          label="Sales and History"
          hint="Orders and daily sales, CSV"
          href="/sales"
        />
        {owner ? (
          <LinkRow
            icon="user"
            label="Staff"
            hint="Kitchen logins and tablets"
            href="/kitchen-staff"
          />
        ) : null}
      </Card>
      <Card>
        <Text variant="strong">{account?.displayName}</Text>
        <Text variant="muted">{account?.role === 'restaurant_owner' ? 'Owner' : 'Staff'}</Text>
      </Card>
      <Button variant="secondary" label="Sign Out" onPress={() => void signOut()} />
    </Screen>
  );
}
