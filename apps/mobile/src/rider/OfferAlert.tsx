import { DECLINE_REASONS, formatLkr, type DeclineReason, type RiderOffer } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Chip, Icon, Radio, Text } from '@/components';
import { useCountdown } from '@/hooks/useCountdown';
import { colors, fonts } from '@/theme/tokens';
import ALARM from '../../assets/sounds/new-order.wav';
import { RIDER_STATE } from './queries';

const REASONS: Record<DeclineReason, string> = {
  too_far: 'Too far',
  vehicle_issue: 'Vehicle problem',
  on_break: 'Taking a break',
  other: 'Other',
};

/** R03 + R04: a job offer rings full screen with a 60 s countdown (RID-03). */
export function OfferAlert({ offer }: { offer: RiderOffer | null }) {
  const queryClient = useQueryClient();
  const left = useCountdown(offer?.expiresAt);
  const player = useAudioPlayer(ALARM);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason>('too_far');
  const live = !!offer && left > 0;

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);
  useEffect(() => {
    player.loop = true;
    if (live) player.play();
    else player.pause();
  }, [live, player]);
  useEffect(() => {
    if (!live) setDeclining(false);
  }, [live]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: RIDER_STATE });
  const accept = useMutation({
    mutationFn: () => riderApi.accept(offer!.id),
    onSuccess: async () => {
      await refresh();
      router.push(`/job/${offer!.orderId}`);
    },
  });
  const decline = useMutation({
    mutationFn: () => riderApi.decline(offer!.id, reason),
    onSuccess: refresh,
  });

  if (!live) return null;
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <SafeAreaView style={styles.screen}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Chip tone="green" label="New Job · Ringing" style={{ alignSelf: 'center' }} />
          <Text variant="h1" accessibilityRole="header" style={{ textAlign: 'center' }}>
            Accept This Delivery?
          </Text>
        </View>
        <View style={styles.ring} accessibilityLabel={`${left} seconds left`}>
          <Text variant="big">{left}</Text>
          <Text variant="small">seconds</Text>
        </View>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <View style={styles.stop}>
            <View style={[styles.tile, { backgroundColor: colors.raise }]}>
              <Icon name="home" />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="small">Pick up</Text>
              <Text variant="strong">{offer!.restaurant.name}</Text>
              <Text variant="small">{offer!.restaurant.address}</Text>
            </View>
          </View>
          <View style={[styles.stop, { borderBottomWidth: 0 }]}>
            <View style={styles.tile}>
              <Icon name="pin" color="#ffffff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="small">{`Drop off · ${(offer!.dropoffDistanceMeters / 1000).toFixed(1)} km trip`}</Text>
              <Text variant="strong">{`#${offer!.reference} · ${offer!.itemCount} ${offer!.itemCount === 1 ? 'item' : 'items'}`}</Text>
              <Text variant="small">Full address shows once you accept.</Text>
            </View>
          </View>
        </Card>
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {offer!.collectCents ? formatLkr(offer!.collectCents) : 'Paid'}
            </Text>
            <Text style={styles.statKey}>
              {offer!.collectCents ? 'Collect in cash' : 'Nothing to collect'}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatLkr(offer!.payoutCents)}</Text>
            <Text style={styles.statKey}>You earn</Text>
          </View>
        </View>
        {accept.error || decline.error ? (
          <Alert tone="danger" message={errorMessage(accept.error ?? decline.error)} />
        ) : null}
        <View style={{ flex: 1 }} />
        {declining ? (
          <Card style={{ gap: 0 }}>
            <Text variant="strong" style={{ paddingVertical: 6 }}>
              Why are you declining?
            </Text>
            {DECLINE_REASONS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="radio"
                accessibilityState={{ checked: reason === r }}
                onPress={() => setReason(r)}
                style={styles.reason}
              >
                <Radio on={reason === r} />
                <Text>{REASONS[r]}</Text>
              </Pressable>
            ))}
            <View style={[styles.stats, { marginTop: 10 }]}>
              <View style={{ flex: 1 }}>
                <Button variant="secondary" label="Back" onPress={() => setDeclining(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  variant="danger"
                  label="Decline"
                  loading={decline.isPending}
                  onPress={() => decline.mutate()}
                />
              </View>
            </View>
          </Card>
        ) : (
          <View style={styles.stats}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Decline" onPress={() => setDeclining(true)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                label="Accept"
                loading={accept.isPending}
                onPress={() => accept.mutate()}
                style={{ minHeight: 64 }}
              />
            </View>
          </View>
        )}
        <Text variant="small" style={{ textAlign: 'center' }}>
          No answer in 60 s counts as missed and goes back to dispatch.
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bar, padding: 20, paddingTop: 28, gap: 16 },
  ring: {
    width: 120,
    height: 120,
    borderRadius: 9999,
    borderWidth: 8,
    borderColor: colors.brand,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', gap: 10 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 16,
    padding: 12,
    gap: 2,
  },
  statValue: { fontFamily: fonts.display600, fontSize: 18, lineHeight: 24, color: colors.strong },
  statKey: { fontFamily: fonts.sans600, fontSize: 12, color: colors.muted },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
});
