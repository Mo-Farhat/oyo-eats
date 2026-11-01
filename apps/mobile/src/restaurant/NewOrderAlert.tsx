import { formatLkr, type RestaurantOrder } from '@oyo/shared';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Chip, Icon, PriceRow, Text } from '@/components';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { colors, fonts } from '@/theme/tokens';
import ALARM from '../../assets/sounds/new-order.wav';
import { useBoard, useSeenOrders } from './queries';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-LK', {
    timeZone: 'Asia/Colombo',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * T02: a new order takes over the screen and rings on repeat until opened (RES-02). In the
 * foreground only for now; ringing with the screen locked needs the native alarm (Notifee) and a
 * development build (docs/NEEDS-YOU.md).
 */
export function NewOrderAlert() {
  const board = useBoard();
  const seen = useSeenOrders((s) => s.seen);
  const markSeen = useSeenOrders((s) => s.markSeen);
  const order: RestaurantOrder | undefined = board.data?.new.find((o) => !seen.has(o.id));
  const player = useAudioPlayer(ALARM);
  const left = useCountdown(order?.respondBy);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  useEffect(() => {
    player.loop = true;
    if (order) player.play();
    else player.pause();
  }, [order?.id, player]);

  if (!order) return null;
  const note = order.lines.find((l) => l.note)?.note;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.ring}>
          <View style={styles.bell}>
            <Icon name="bell" size={44} color="#ffffff" />
          </View>
        </View>
        <View style={{ gap: 6, alignItems: 'center' }}>
          <Chip label="Ringing" tone="green" style={{ alignSelf: 'center' }} />
          <Text style={styles.title} accessibilityRole="header">
            New Order #{order.reference}
          </Text>
          <Text variant="muted">
            Placed {time(order.placedAt)} · {order.paid ? 'Paid' : 'Cash on delivery'}
          </Text>
        </View>
        <Card style={{ alignSelf: 'stretch', gap: 2 }}>
          {order.lines.map((l, i) => (
            <PriceRow key={i} label={`${l.quantity} × ${l.name}`} cents={l.lineTotalCents} />
          ))}
          <PriceRow label="Food total" cents={order.itemsCents} total />
          {note ? <Text variant="small">{`Note: “${note}”`}</Text> : null}
        </Card>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="big">{mmss(left)}</Text>
          <Text variant="small">Auto-rejects when this reaches 0:00</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Button
          label="Open Order"
          style={{ minHeight: 64 }}
          onPress={() => {
            markSeen(order.id);
            router.push(`/kitchen/${order.id}`);
          }}
        />
        <Text
          variant="small"
          style={{ textAlign: 'center' }}
        >{`${formatLkr(order.itemsCents)} food total · rings until opened`}</Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bar,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 28,
    gap: 20,
    alignItems: 'center',
  },
  ring: { padding: 32, borderRadius: 9999, backgroundColor: 'rgba(100,132,2,0.1)' },
  bell: {
    width: 96,
    height: 96,
    borderRadius: 9999,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 16,
    borderColor: 'rgba(100,132,2,0.2)',
  },
  title: {
    fontFamily: fonts.display800,
    fontSize: 34,
    lineHeight: 42,
    color: colors.strong,
    textAlign: 'center',
  },
});
