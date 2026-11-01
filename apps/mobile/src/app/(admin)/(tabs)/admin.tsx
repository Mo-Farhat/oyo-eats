import { formatLkr, type DispatchOrder } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { Alert, Button, Card, Chip, Icon, Screen, Segmented, Text } from '@/components';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { SLIPS, useDispatchBoard } from '@/admin/queries';
import { colors, fonts } from '@/theme/tokens';

type Tab = 'unassigned' | 'waiting' | 'active' | 'done';

const ageMin = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const PAY = { cod: 'Cash', bank_transfer: 'Bank ✓', card: 'Card' } as const;

function kitchen(o: DispatchOrder): { label: string; tone: 'neutral' | 'warn' | 'green' } {
  if (o.status === 'awaiting_restaurant') return { label: 'Kitchen: Waiting', tone: 'neutral' };
  if (o.kitchenStatus === 'ready') return { label: 'Kitchen: Ready', tone: 'green' };
  if (o.readyBy)
    return {
      label: `Kitchen: ${Math.max(0, Math.ceil((new Date(o.readyBy).getTime() - Date.now()) / 60_000))} min`,
      tone: 'warn',
    };
  return { label: 'Kitchen: Preparing', tone: 'warn' };
}

function OrderCard({ o, tab }: { o: DispatchOrder; tab: Tab }) {
  const offerLeft = useCountdown(o.offer?.expiresAt);
  const k = kitchen(o);
  const head =
    o.offer && offerLeft > 0 ? (
      <Chip tone="warn" label={`Offered · ${mmss(offerLeft)}`} />
    ) : o.late ? (
      <Chip tone="danger" label="Unassigned too long" />
    ) : o.rider ? (
      <Chip
        tone="info"
        label={
          o.status === 'picked_up'
            ? `On the way · ${o.rider.name.split(' ')[0]}`
            : `Rider ${o.rider.name.split(' ')[0]}`
        }
      />
    ) : o.status === 'awaiting_restaurant' ? (
      <Chip label="New" />
    ) : tab === 'done' ? (
      <Chip
        label={
          o.status === 'delivered'
            ? 'Delivered'
            : o.status === 'rejected'
              ? 'Rejected'
              : o.status === 'failed'
                ? 'Failed'
                : 'Cancelled'
        }
      />
    ) : (
      <Chip tone="danger" label="Needs a rider" />
    );
  return (
    <Card
      tone={o.late ? 'danger' : 'default'}
      style={{ gap: 8, paddingVertical: 12, paddingHorizontal: 14 }}
    >
      {/* Only the top is pressable, so the Assign button isn't a button inside a button. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Order ${o.reference} details`}
        onPress={() => router.push(`/ticket/${o.id}`)}
        style={{ gap: 8 }}
      >
        <View style={styles.between}>
          <Text variant="h3">#{o.reference}</Text>
          {head}
        </View>
        <Text variant="small" style={{ color: colors.body }}>
          <Text variant="strong">{o.restaurant.name}</Text>
          {`  →  ${o.customerFirstName} · ${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`}
        </Text>
      </Pressable>
      <View style={styles.between}>
        <View style={styles.chips}>
          {tab !== 'done' ? <Chip tone={k.tone} label={k.label} /> : null}
          <Chip
            label={
              o.paymentMethod === 'cod'
                ? `Cash ${formatLkr(o.totalCents).replace('LKR ', '')}`
                : PAY[o.paymentMethod]
            }
          />
        </View>
        <Text
          variant="small"
          style={o.late ? { color: colors.danger } : undefined}
        >{`${ageMin(o.placedAt)} min`}</Text>
      </View>
      {tab === 'unassigned' && !o.offer ? (
        <Button
          small
          label="Assign Rider"
          variant={o.late ? 'primary' : 'secondary'}
          style={{ alignSelf: 'stretch' }}
          onPress={() => router.push(`/assign/${o.id}`)}
        />
      ) : null}
      {tab === 'unassigned' && o.offer ? (
        <Button
          small
          variant="ghost"
          label={`Waiting on ${o.offer.riderName.split(' ')[0]} · manage`}
          onPress={() => router.push(`/assign/${o.id}`)}
        />
      ) : null}
    </Card>
  );
}

/** A01: the dispatch board. Stays awake on shift. */
export default function DispatchBoard() {
  useKeepAwake();
  const name = useSession((s) => s.session?.account.displayName);
  const board = useDispatchBoard();
  const slips = useQuery({
    queryKey: SLIPS,
    queryFn: dispatchApi.slips,
    refetchInterval: 15_000,
  });
  const [tab, setTab] = useState<Tab>('unassigned');
  const b = board.data;
  const lists: Record<Tab, DispatchOrder[]> = {
    unassigned: b?.unassigned ?? [],
    waiting: b?.awaitingRestaurant ?? [],
    active: [...(b?.assigned ?? []), ...(b?.outForDelivery ?? [])],
    done: b?.doneToday ?? [],
  };
  const late = lists.unassigned.filter((o) => o.late).length;

  return (
    <Screen
      inTabs
      top={
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="small">{`Dispatch · ${name?.split(' ')[0] ?? ''}`}</Text>
            <Text variant="h2" accessibilityRole="header">
              Orders
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${slips.data?.length ?? 0} bank slips to verify`}
            onPress={() => router.push('/slips')}
            style={styles.slipButton}
          >
            <Icon name="bank" />
            {slips.data?.length ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{slips.data.length}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      }
      bodyStyle={{ gap: 10 }}
    >
      {late ? (
        <Alert
          tone="danger"
          message={`${late} ${late === 1 ? 'order has' : 'orders have'} waited too long for a rider.`}
        />
      ) : null}
      {board.error ? <Alert tone="danger" message={errorMessage(board.error)} /> : null}
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'unassigned', label: `Unassigned ${lists.unassigned.length}` },
          { value: 'waiting', label: `New ${lists.waiting.length}` },
          { value: 'active', label: `Active ${lists.active.length}` },
          { value: 'done', label: 'Done' },
        ]}
      />
      {lists[tab].map((o) => (
        <OrderCard key={o.id} o={o} tab={tab} />
      ))}
      {b && lists[tab].length === 0 ? <Text variant="muted">Nothing here right now.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chips: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  slipButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 9999,
    backgroundColor: colors.dangerFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { fontFamily: fonts.sans700, fontSize: 12, color: '#ffffff' },
});
