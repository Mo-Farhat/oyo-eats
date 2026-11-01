import { can, type AdminRestaurantSummary } from '@oyo/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/api/messages';
import { useAdminRestaurants } from '@/admin/queries';
import { useSession } from '@/auth/session';
import { Alert, Button, Card, Chip, Icon, Screen, Text } from '@/components';
import { colors } from '@/theme/tokens';

const STATUS = {
  active: { label: 'Live', tone: 'green' },
  onboarding: { label: 'Setting up', tone: 'warn' },
  suspended: { label: 'Suspended', tone: 'danger' },
} as const;

function Row({ r }: { r: AdminRestaurantSummary }) {
  const s = STATUS[r.status];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${s.label}`}
      onPress={() => router.push(`/venue/${r.id}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.between}>
          <Text variant="strong" style={{ flex: 1 }}>
            {r.name}
          </Text>
          <Chip label={s.label} tone={s.tone} />
        </View>
        <Text variant="small" numberOfLines={1}>
          {[
            r.status === 'active' ? (r.isOpen ? 'Open now' : 'Closed now') : null,
            `${r.ordersToday} ${r.ordersToday === 1 ? 'order' : 'orders'} today`,
            r.addressText,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A13: every restaurant with its status; the owner adds and sets them up here (ADM-11). */
export default function Restaurants() {
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'restaurants.manage');
  const list = useAdminRestaurants(owner);
  const groups = (['onboarding', 'active', 'suspended'] as const)
    .map((status) => ({ status, rows: (list.data ?? []).filter((r) => r.status === status) }))
    .filter((g) => g.rows.length);

  return (
    <Screen inTabs bodyStyle={{ gap: 12, paddingTop: 24 }}>
      <View style={styles.between}>
        <Text variant="h1" accessibilityRole="header">
          Restaurants
        </Text>
        {owner ? <Button small label="Add" onPress={() => router.push('/venue/new')} /> : null}
      </View>
      {!owner ? (
        <Card>
          <Text variant="muted">
            Adding and setting up restaurants is for the owner. You can still create kitchen logins
            from the People tab.
          </Text>
        </Card>
      ) : null}
      {list.error ? <Alert tone="danger" message={errorMessage(list.error)} /> : null}
      {owner && list.data?.length === 0 ? (
        <Card>
          <Text variant="strong">No restaurants yet</Text>
          <Text variant="muted">
            Add the first one: its address, licence and bank details, then hours, menu and a login
            for the kitchen tablet.
          </Text>
        </Card>
      ) : null}
      {groups.map((g) => (
        <View key={g.status} style={{ gap: 8 }}>
          <Text variant="label">{`${STATUS[g.status].label} (${g.rows.length})`}</Text>
          {g.rows.map((r) => (
            <Row key={r.id} r={r} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
});
