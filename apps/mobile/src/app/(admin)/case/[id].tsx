import {
  can,
  CASE_LABELS,
  formatLkr,
  REFUND_REASON_LABELS,
  type CaseType,
  type RefundReason,
  type SupportCase,
} from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { RefundForm } from '@/admin/RefundForm';
import { useSession } from '@/auth/session';
import { call, localPhone } from '@/call';
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
import { colors } from '@/theme/tokens';

const DEFAULT_REASON: Partial<Record<string, RefundReason>> = {
  missing_item: 'missing_item',
  wrong_item: 'wrong_item',
  cold_food: 'cold_food',
  late: 'late_delivery',
  cancel_request: 'cancelled_after_accept',
  refund_bank_transfer: 'cancelled_paid_transfer',
};

/** A22: one case: who, what, photos, the order's money, refunds, and closing it. */
export default function CaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'refunds.issue_any');
  const queryClient = useQueryClient();
  const key = ['case', id];
  const c = useQuery({ queryKey: key, queryFn: () => dispatchApi.case(id) });
  const [refunding, setRefunding] = useState(false);
  const [resolution, setResolution] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const refundKey = useMemo(() => Crypto.randomUUID(), [c.data?.refunds.length]);
  const done = (d: SupportCase) => {
    queryClient.setQueryData(key, d);
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  };
  const refund = useMutation({
    mutationFn: (input: Parameters<typeof dispatchApi.refundCase>[1]) =>
      dispatchApi.refundCase(id, input, refundKey),
    onSuccess: (d) => {
      done(d);
      setRefunding(false);
    },
  });
  const paid = useMutation({
    mutationFn: (refundId: string) =>
      dispatchApi.refundPaid(refundId, undefined, `paid-${refundId}`),
    onSuccess: done,
  });
  const resolve = useMutation({
    mutationFn: () => dispatchApi.resolveCase(id, resolution.trim()),
    onSuccess: done,
  });
  const d = c.data;
  const error = c.error ?? paid.error ?? resolve.error;

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/support'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              {d ? (CASE_LABELS[d.type as CaseType] ?? d.type) : 'Case'}
            </Text>
            {d?.order ? (
              <Text variant="small">{`#${d.order.reference} · ${d.order.restaurantName}`}</Text>
            ) : null}
          </View>
          {d ? (
            <Chip
              label={
                d.status === 'resolved'
                  ? 'Resolved'
                  : d.status === 'in_progress'
                    ? 'In progress'
                    : 'Open'
              }
              tone={d.status === 'resolved' ? 'green' : 'warn'}
            />
          ) : null}
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
      {d ? (
        <>
          <Card style={{ gap: 6 }}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text variant="label">{`Reported by the ${d.reporter.role}`}</Text>
                <Text variant="strong">{d.reporter.name}</Text>
                {d.reporter.phone ? (
                  <Text variant="small">{localPhone(d.reporter.phone)}</Text>
                ) : null}
              </View>
              {d.reporter.phone ? (
                <Button
                  small
                  variant="secondary"
                  label="Call"
                  onPress={() => call(d.reporter.phone!)}
                />
              ) : null}
            </View>
            {d.description ? <Text variant="body">{d.description}</Text> : null}
            {d.location ? (
              <Text variant="small">{`Location ${d.location.lat.toFixed(5)}, ${d.location.lng.toFixed(5)}`}</Text>
            ) : null}
            {d.photos.length ? (
              <View style={styles.photos}>
                {d.photos.map((p, i) => (
                  <Pressable
                    key={p}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={`Photo ${i + 1}`}
                    onPress={() => setZoom(p)}
                  >
                    <Image source={{ uri: p }} style={styles.thumb} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          {d.order ? (
            <Card style={{ gap: 6 }}>
              <View style={styles.between}>
                <Text variant="strong">{`Order ${formatLkr(d.order.totalCents)} · ${d.order.paymentMethod === 'cod' ? 'cash' : 'bank transfer'}`}</Text>
                <Button
                  small
                  variant="ghost"
                  label="View Order"
                  onPress={() => router.push(`/ticket/${d.order!.id}`)}
                />
              </View>
              <Text variant="small">
                {d.order.paidCents
                  ? `Paid ${formatLkr(d.order.paidCents)} · ${formatLkr(d.order.refundableCents)} left to refund`
                  : 'Nothing paid yet, so nothing to refund.'}
              </Text>
              {d.type === 'cancel_request' && d.status !== 'resolved' ? (
                <Text variant="small">
                  To cancel, open the order and use Cancel Order, then close this case.
                </Text>
              ) : null}
              {d.order.refundableCents > 0 && d.status !== 'resolved' ? (
                <Button variant="secondary" label="Refund" onPress={() => setRefunding(true)} />
              ) : null}
            </Card>
          ) : null}

          {d.refunds.length ? (
            <Card style={{ gap: 8 }}>
              <Text variant="strong">Refunds</Text>
              {d.refunds.map((r) => (
                <View key={r.id} style={styles.refund}>
                  <View style={styles.between}>
                    <Text variant="strong">{formatLkr(r.amountCents)}</Text>
                    <Chip
                      label={r.status === 'paid' ? 'Transferred' : 'To transfer'}
                      tone={r.status === 'paid' ? 'green' : 'warn'}
                    />
                  </View>
                  <Text variant="small">
                    {`${REFUND_REASON_LABELS[r.reasonCode as RefundReason] ?? r.reasonCode} · borne by ${r.attribution === 'oyo' ? 'Oyo Eats' : r.attribution} · ${r.issuedBy}`}
                  </Text>
                  {r.status === 'owed' && owner ? (
                    <Button
                      small
                      variant="ghost"
                      label="Mark Transferred"
                      loading={paid.isPending && paid.variables === r.id}
                      onPress={() => paid.mutate(r.id)}
                    />
                  ) : null}
                </View>
              ))}
            </Card>
          ) : null}

          {d.status !== 'resolved' ? (
            <Card style={{ gap: 8 }}>
              <TextField
                label="Close with a note"
                hint={d.reporter.role === 'customer' ? 'The customer sees this.' : undefined}
                value={resolution}
                onChangeText={setResolution}
                multiline
              />
              <Button
                variant="secondary"
                label="Close Case"
                disabled={resolution.trim().length < 3}
                loading={resolve.isPending}
                onPress={() => resolve.mutate()}
              />
            </Card>
          ) : (
            <Card>
              <Text variant="label">Resolution</Text>
              <Text variant="body">{d.resolution}</Text>
            </Card>
          )}
        </>
      ) : null}

      <Sheet visible={refunding} onClose={() => setRefunding(false)} tall>
        <Text variant="h2">Refund</Text>
        {refund.error ? <Alert tone="danger" message={errorMessage(refund.error)} /> : null}
        {d?.order ? (
          <RefundForm
            refundableCents={d.order.refundableCents}
            hasRider={!!d.order.riderId}
            busy={refund.isPending}
            defaultReason={DEFAULT_REASON[d.type] ?? 'goodwill'}
            onSubmit={(input) => refund.mutate(input)}
          />
        ) : null}
      </Sheet>
      <Sheet visible={!!zoom} onClose={() => setZoom(null)} tall>
        {zoom ? <Image source={{ uri: zoom }} style={styles.full} resizeMode="contain" /> : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  photos: { flexDirection: 'row', gap: 8 },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: colors.photo },
  full: { width: '100%', height: 560, backgroundColor: colors.panel },
  refund: { gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
});
