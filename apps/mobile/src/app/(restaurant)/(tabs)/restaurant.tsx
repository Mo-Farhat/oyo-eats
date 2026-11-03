import { formatLkr, type RestaurantOrder } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Card, Chip, Screen, Segmented, Text, Toggle } from '@/components';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { BOARD, useBoard } from '@/restaurant/queries';

type Tab = 'new' | 'preparing' | 'ready' | 'done';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-LK', {
    timeZone: 'Asia/Colombo',
    hour: 'numeric',
    minute: '2-digit',
  });
const minutesFrom = (iso: string) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

function OrderCard({ o, tab }: { o: RestaurantOrder; tab: Tab }) {
  const respond = useCountdown(o.respondBy);
  const ready = useCountdown(o.readyBy);
  const rider = o.rider ? `Rider ${o.rider.name.split(' ')[0]}` : 'Rider not assigned yet';
  const summary = `${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${o.reference}`}
      onPress={() => router.push(`/kitchen/${o.id}`)}
    >
      <Card
        tone={tab === 'new' ? 'danger' : tab === 'ready' ? 'green' : 'default'}
        style={{ gap: 6 }}
      >
        <View style={styles.between}>
          <Text variant="h3">#{o.reference}</Text>
          {tab === 'new' ? <Chip tone="danger" label={`Respond in ${mmss(respond)}`} /> : null}
          {tab === 'preparing' && o.readyBy ? (
            <Chip
              tone={ready > 0 ? 'warn' : 'danger'}
              label={
                ready > 0
                  ? `Ready by ${time(o.readyBy)} · ${Math.ceil(ready / 60)} min`
                  : 'Running late'
              }
            />
          ) : null}
          {tab === 'ready' && o.readyAt ? (
            <Chip tone="green" label={`Ready · waiting ${minutesFrom(o.readyAt)} min`} />
          ) : null}
          {tab === 'done' ? (
            <Chip
              label={
                o.status === 'rejected'
                  ? 'Rejected'
                  : o.status === 'cancelled'
                    ? 'Cancelled'
                    : 'Picked up'
              }
            />
          ) : null}
        </View>
        <Text variant="muted">
          {tab === 'new'
            ? `${summary} · ${formatLkr(o.itemsCents)} · ${o.customerFirstName}`
            : tab === 'done'
              ? `${summary} · ${formatLkr(o.itemsCents)} · ${time(o.placedAt)}`
              : `${summary} · ${rider}`}
        </Text>
      </Card>
    </Pressable>
  );
}

/** T01: the kitchen board. Stays awake through a shift (section 6). */
export default function Board() {
  useKeepAwake();
  const queryClient = useQueryClient();
  const board = useBoard();
  const [tab, setTab] = useState<Tab>('new');
  const b = board.data;
  const setOpen = useMutation({
    mutationFn: (open: boolean) => restaurantApi.setOpen(open),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: BOARD }),
  });

  const counts = {
    new: b?.new.length ?? 0,
    preparing: b?.preparing.length ?? 0,
    ready: b?.ready.length ?? 0,
    done: b?.done.length ?? 0,
  };
  const list = b ? b[tab] : [];

  return (
    <Screen
      inTabs
      top={
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="small">{b?.restaurant.name ?? ' '}</Text>
            <Text variant="h2" accessibilityRole="header">
              Orders
            </Text>
          </View>
          <Text variant="strong">{b?.restaurant.open ? 'Open' : 'Closed'}</Text>
          <Toggle
            label="Taking orders"
            value={b?.restaurant.open ?? false}
            onChange={(v) => setOpen.mutate(v)}
          />
        </View>
      }
      bodyStyle={{ gap: 12 }}
    >
      {b && !b.restaurant.open ? (
        <Alert message="Closed: customers can't order until you switch back on." />
      ) : null}
      {board.error ? <Alert tone="danger" message={errorMessage(board.error)} /> : null}
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'new', label: `New ${counts.new}` },
          { value: 'preparing', label: `Preparing ${counts.preparing}` },
          { value: 'ready', label: `Ready ${counts.ready}` },
          { value: 'done', label: 'Done' },
        ]}
      />
      {list.map((o) => (
        <OrderCard key={o.id} o={o} tab={tab} />
      ))}
      {b && list.length === 0 ? (
        <Text variant="muted">
          {tab === 'new'
            ? 'No new orders. They ring here the moment they arrive.'
            : tab === 'done'
              ? 'Nothing finished yet today.'
              : 'Nothing here right now.'}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
