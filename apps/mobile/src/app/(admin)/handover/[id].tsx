import { formatLkr } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { rupeesToCents } from '@/admin/MenuItemForm';
import { ADMIN_RIDERS, adminRiderKey } from '@/admin/queries';
import { useSession } from '@/auth/session';
import { Alert, BottomBar, Button, Card, IconButton, Screen, Text, TextField } from '@/components';
import { colors } from '@/theme/tokens';

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

/**
 * A11: record cash a rider hands to the office (ADM-09). Expected is everything they hold; any
 * difference needs a reason, stays on their balance, and waits for the owner's sign-off.
 */
export default function CashHandover() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession((s) => s.session?.account.displayName);
  const queryClient = useQueryClient();
  const rider = useQuery({ queryKey: adminRiderKey(id), queryFn: () => dispatchApi.rider(id) });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // One key per screen visit: a retry after a dropped connection can't record the cash twice.
  const key = useMemo(() => Crypto.randomUUID(), []);
  const r = rider.data;
  const cents = amount.trim() ? rupeesToCents(amount) : NaN;
  const valid = Number.isFinite(cents) && cents >= 0;
  const diff = r && valid ? cents - r.cashHeldCents : 0;
  const record = useMutation({
    mutationFn: () =>
      dispatchApi.handover(
        id,
        { amountCents: cents, reason: diff ? reason.trim() : undefined },
        key,
      ),
    onSuccess: (d) => {
      queryClient.setQueryData(adminRiderKey(id), d);
      void queryClient.invalidateQueries({ queryKey: ADMIN_RIDERS });
      router.back();
    },
  });

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Cash Handover
            </Text>
            {r ? <Text variant="small">{`${r.name} · recorded by ${me ?? 'you'}`}</Text> : null}
          </View>
        </>
      }
      footer={
        <BottomBar>
          <Button
            label={valid ? `Record ${formatLkr(cents)}` : 'Record Handover'}
            disabled={!r || !valid || (diff !== 0 && reason.trim().length < 3)}
            loading={record.isPending}
            onPress={() => record.mutate()}
          />
        </BottomBar>
      }
      bodyStyle={{ gap: 12 }}
    >
      {rider.error || record.error ? (
        <Alert tone="danger" message={errorMessage(rider.error ?? record.error)} />
      ) : null}
      {r ? (
        <>
          <Card style={{ gap: 0, paddingVertical: 6 }}>
            <Text variant="label" style={{ paddingVertical: 6 }}>
              COD orders since the last handover
            </Text>
            {r.cashOrders.map((o) => (
              <View key={o.orderId} style={styles.line}>
                <View style={{ flex: 1 }}>
                  <Text variant="strong">{`#${o.reference}`}</Text>
                  <Text variant="small">{time(o.deliveredAt)}</Text>
                </View>
                <Text variant="strong">{formatLkr(o.cashCents)}</Text>
              </View>
            ))}
            {r.cashOrders.length === 0 ? (
              <Text variant="small" style={{ paddingBottom: 6 }}>
                None. What they hold is left over from an earlier handover.
              </Text>
            ) : null}
            <View style={[styles.line, styles.total]}>
              <Text variant="strong" style={{ flex: 1 }}>
                Expected
              </Text>
              <Text variant="h3">{formatLkr(r.cashHeldCents)}</Text>
            </View>
          </Card>
          <TextField
            label="Amount received"
            prefix="LKR"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={(r.cashHeldCents / 100).toFixed(0)}
          />
          <Button
            small
            variant="ghost"
            label="Exact amount"
            onPress={() => setAmount(String(r.cashHeldCents / 100))}
          />
          {valid && diff !== 0 ? (
            <>
              <Alert
                tone={diff < 0 ? 'danger' : 'warn'}
                message={
                  diff < 0
                    ? `Short by ${formatLkr(-diff)}. It stays on ${r.name.split(' ')[0]}’s balance until the owner signs it off.`
                    : `Over by ${formatLkr(diff)}. Check the count; it’s recorded as given.`
                }
              />
              <TextField
                label="Reason"
                hint="What the rider said, in a few words."
                value={reason}
                onChangeText={setReason}
              />
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  total: { paddingVertical: 10 },
});
