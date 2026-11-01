import { formatLkr, type SlipReviewItem } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { DISPATCH_BOARD, SLIPS } from '@/admin/queries';
import {
  Alert,
  Button,
  Card,
  Chip,
  IconButton,
  Screen,
  Sheet,
  Text,
  TextField,
} from '@/components';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { colors } from '@/theme/tokens';

const QUICK_REASONS = [
  'Amount doesn’t match the order',
  'Slip is blurry or cut off',
  'Not a bank transfer slip',
  'Payment not received in the account',
];
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'just now' : `${m} min ago`;
};

type Decision = { slip: SlipReviewItem; resubmit: boolean } | null;

function SlipCard({
  slip,
  onApprove,
  onDecline,
  onZoom,
  approving,
}: {
  slip: SlipReviewItem;
  onApprove: () => void;
  onDecline: (resubmit: boolean) => void;
  onZoom: () => void;
  approving: boolean;
}) {
  const left = useCountdown(slip.expiresAt);
  const mismatch =
    slip.declaredAmountCents !== null && slip.declaredAmountCents !== slip.amountCents;
  return (
    <Card tone={mismatch ? 'warn' : 'default'}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{`#${slip.reference}`}</Text>
          <Text variant="small">{`${slip.restaurantName} · uploaded ${ago(slip.uploadedAt)}`}</Text>
        </View>
        <Chip
          label={left > 0 ? `${mmss(left)} left` : 'Window passed, held'}
          tone={left > 0 && left < 300 ? 'warn' : 'neutral'}
        />
      </View>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel="Enlarge slip" onPress={onZoom}>
        <Image source={{ uri: slip.imageUrl }} style={styles.thumb} resizeMode="contain" />
      </Pressable>
      <View style={styles.facts}>
        <View style={{ flex: 1 }}>
          <Text variant="label">Order total</Text>
          <Text variant="strong">{formatLkr(slip.amountCents)}</Text>
        </View>
        {slip.declaredAmountCents !== null ? (
          <View style={{ flex: 1 }}>
            <Text variant="label">Customer says</Text>
            <Text variant="strong" style={mismatch ? { color: colors.warn } : undefined}>
              {formatLkr(slip.declaredAmountCents)}
            </Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text variant="label">Bank ref</Text>
          <Text variant="strong" selectable>
            {slip.bankReference ?? '—'}
          </Text>
        </View>
      </View>
      <Text variant="small">
        Check the amount and the reference in the business account before approving. Approving sends
        the order to the restaurant.
      </Text>
      <Button label="Payment Received · Approve" loading={approving} onPress={onApprove} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            small
            label="Ask for New Slip"
            onPress={() => onDecline(true)}
          />
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Button variant="ghost" small label="Reject Payment" onPress={() => onDecline(false)} />
        </View>
      </View>
    </Card>
  );
}

/** A12: bank-transfer slips waiting for a dispatcher, oldest first (CUS-09, SEC-24). */
export default function Slips() {
  const queryClient = useQueryClient();
  const slips = useQuery({ queryKey: SLIPS, queryFn: dispatchApi.slips, refetchInterval: 10_000 });
  const [zoom, setZoom] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [reason, setReason] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: SLIPS });
    void queryClient.invalidateQueries({ queryKey: DISPATCH_BOARD });
  };
  const approve = useMutation({ mutationFn: dispatchApi.approveSlip, onSuccess: refresh });
  const reject = useMutation({
    mutationFn: (d: { slipId: string; reason: string; resubmit: boolean }) =>
      dispatchApi.rejectSlip(d.slipId, d.reason, d.resubmit),
    onSuccess: () => {
      setDecision(null);
      setReason('');
      refresh();
    },
  });
  const list = slips.data ?? [];

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Bank Slips
            </Text>
            <Text variant="small">{`${list.length} waiting`}</Text>
          </View>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {slips.error || approve.error ? (
        <Alert tone="danger" message={errorMessage(slips.error ?? approve.error)} />
      ) : null}
      {slips.data && list.length === 0 ? (
        <Card>
          <Text variant="strong">All clear</Text>
          <Text variant="muted">No slips waiting. New ones show up here and on the board.</Text>
        </Card>
      ) : null}
      {list.map((s) => (
        <SlipCard
          key={s.slipId}
          slip={s}
          approving={approve.isPending && approve.variables === s.slipId}
          onApprove={() => approve.mutate(s.slipId)}
          onDecline={(resubmit) => setDecision({ slip: s, resubmit })}
          onZoom={() => setZoom(s.imageUrl)}
        />
      ))}

      <Sheet visible={!!zoom} onClose={() => setZoom(null)} tall>
        {zoom ? <Image source={{ uri: zoom }} style={styles.full} resizeMode="contain" /> : null}
        <Button variant="secondary" label="Close" onPress={() => setZoom(null)} />
      </Sheet>

      <Sheet
        visible={!!decision}
        onClose={() => setDecision(null)}
        footer={
          <Button
            variant={decision?.resubmit ? 'primary' : 'danger'}
            label={decision?.resubmit ? 'Ask for a New Slip' : 'Reject and Cancel Order'}
            disabled={reason.trim().length < 3}
            loading={reject.isPending}
            onPress={() =>
              decision &&
              reject.mutate({
                slipId: decision.slip.slipId,
                reason: reason.trim(),
                resubmit: decision.resubmit,
              })
            }
          />
        }
      >
        <Text variant="h2">
          {decision?.resubmit ? 'Ask for a new slip' : `Reject #${decision?.slip.reference ?? ''}`}
        </Text>
        <Text variant="muted">
          {decision?.resubmit
            ? 'The customer sees your reason and can upload another slip while the window is open.'
            : 'Only when no money arrived or the slip isn’t genuine. The order is cancelled at once and the customer is told.'}
        </Text>
        <View style={styles.reasons}>
          {QUICK_REASONS.map((r) => (
            <Pressable key={r} accessibilityRole="button" onPress={() => setReason(r)}>
              <Chip label={r} tone={reason === r ? 'on' : 'neutral'} />
            </Pressable>
          ))}
        </View>
        <TextField label="Reason the customer will see" value={reason} onChangeText={setReason} />
        {reject.error ? <Alert tone="danger" message={errorMessage(reject.error)} /> : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  facts: { flexDirection: 'row', gap: 8 },
  thumb: { width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.panel },
  full: { width: '100%', height: 560, backgroundColor: colors.panel },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
