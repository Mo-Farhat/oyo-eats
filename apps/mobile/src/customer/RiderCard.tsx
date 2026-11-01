import type { OrderDetail } from '@oyo/shared';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { call, localPhone } from '@/call';
import { Button, Card, Icon, Sheet, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

type Rider = NonNullable<OrderDetail['rider']>;

const vehicleLine = (r: Rider) => [r.vehicle, r.plate].filter(Boolean).join(' · ');

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** The assigned rider with a Call button while the delivery is open (CUS-12). */
export function RiderCard({ rider }: { rider: Rider }) {
  return (
    <Card>
      <View style={styles.row}>
        <Avatar name={rider.name} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="strong">{`${rider.name} is your rider`}</Text>
          {vehicleLine(rider) ? <Text variant="small">{vehicleLine(rider)}</Text> : null}
          {rider.phone ? <Text variant="small">{localPhone(rider.phone)}</Text> : null}
        </View>
      </View>
      {rider.phone ? (
        <Button
          variant="secondary"
          label={`Call ${rider.name}`}
          onPress={() => call(rider.phone!)}
        />
      ) : null}
    </Card>
  );
}

// Orders whose "rider assigned" pop-up has been shown this session.
const announced = new Set<string>();

/**
 * C10: pops up once when a rider takes the order, with their number. Push notifications carry the
 * same message when the app is closed (section 10, still to come).
 */
export function RiderAssignedPopup({ order }: { order: OrderDetail }) {
  const [open, setOpen] = useState(false);
  const rider = order.rider;
  const live = !!rider?.phone;
  useEffect(() => {
    if (live && !announced.has(order.id)) {
      announced.add(order.id);
      setOpen(true);
    }
  }, [live, order.id]);
  if (!rider) return null;
  return (
    <Sheet
      visible={open}
      onClose={() => setOpen(false)}
      footer={
        <View style={{ gap: 10 }}>
          {rider.phone ? (
            <Button label={`Call ${rider.name}`} onPress={() => call(rider.phone!)} />
          ) : null}
          <Button variant="secondary" label="OK" onPress={() => setOpen(false)} />
        </View>
      }
    >
      <View style={[styles.row, { paddingTop: 4 }]}>
        <View style={styles.badge}>
          <Icon name="scooter" color={colors.onBrand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h2">{`${rider.name} is on your order`}</Text>
          <Text variant="muted">
            {order.status === 'picked_up'
              ? 'Your food is on the way.'
              : `Heading to ${order.restaurant.name} to collect it.`}
          </Text>
        </View>
      </View>
      {vehicleLine(rider) ? <Text variant="body">{vehicleLine(rider)}</Text> : null}
      {rider.phone ? (
        <Text style={styles.phone} selectable>
          {localPhone(rider.phone)}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 9999,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display700, fontSize: 18, color: colors.strong },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 9999,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phone: { fontFamily: fonts.display700, fontSize: 24, color: colors.strong },
});
