import { formatLkr, type SettlementDetail } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
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

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** A16/A17 statement: lines, where to pay, review, mark paid (frozen with a checksum), export. */
export default function Settlement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const key = ['settlement', id];
  const s = useQuery({ queryKey: key, queryFn: () => dispatchApi.settlement(id) });
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState('');
  const payKey = useMemo(() => Crypto.randomUUID(), []);
  const done = (d: SettlementDetail) => {
    queryClient.setQueryData(key, d);
    void queryClient.invalidateQueries({ queryKey: ['settlements', d.party] });
    setPaying(false);
  };
  const review = useMutation({
    mutationFn: () => dispatchApi.reviewSettlement(id),
    onSuccess: done,
  });
  const pay = useMutation({
    mutationFn: () => dispatchApi.paySettlement(id, reference.trim() || undefined, payKey),
    onSuccess: done,
  });
  const share = useMutation({
    mutationFn: async () => {
      const csv = await dispatchApi.settlementCsv(id);
      await Share.share({ message: csv, title: `${d?.partyName ?? ''} statement` });
    },
  });
  const d = s.data;

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header" numberOfLines={1}>
              {d?.partyName ?? 'Statement'}
            </Text>
            {d ? (
              <Text variant="small">{`${day(d.periodStart)} – ${day(d.periodEnd)}`}</Text>
            ) : null}
          </View>
          {d ? (
            <Chip
              label={d.status === 'paid' ? 'Paid' : d.status === 'reviewed' ? 'Reviewed' : 'Draft'}
              tone={d.status === 'paid' ? 'green' : d.status === 'reviewed' ? 'warn' : 'neutral'}
            />
          ) : null}
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {s.error || review.error || pay.error || share.error ? (
        <Alert
          tone="danger"
          message={errorMessage(s.error ?? review.error ?? pay.error ?? share.error)}
        />
      ) : null}
      {d ? (
        <>
          <Card style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="label">
              {d.party === 'restaurant' ? 'Owed to the restaurant' : 'Owed to the rider'}
            </Text>
            <Text variant="big">{formatLkr(d.totalCents)}</Text>
            {d.paidAt ? (
              <Text variant="small">{`Paid ${new Date(d.paidAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}`}</Text>
            ) : null}
          </Card>

          {d.party === 'restaurant' ? (
            <Card style={{ gap: 2 }}>
              <Text variant="label">Pay to</Text>
              {d.bankDetails ? (
                <>
                  <Text variant="strong">{d.bankDetails.accountName}</Text>
                  <Text variant="body" selectable>
                    {`${d.bankDetails.bankName}, ${d.bankDetails.branch}`}
                  </Text>
                  <Text variant="body" selectable>
                    {d.bankDetails.accountNumber}
                  </Text>
                </>
              ) : (
                <Text variant="muted">
                  No bank account on file. Add it on the restaurant’s setup screen.
                </Text>
              )}
            </Card>
          ) : null}

          <Card style={{ gap: 0, paddingVertical: 6 }}>
            {d.lines.map((l, i) => (
              <View key={i} style={styles.line}>
                <Text variant="body" style={{ flex: 1 }}>
                  {l.description}
                </Text>
                <Text variant="strong">{formatLkr(l.amountCents)}</Text>
              </View>
            ))}
            <View style={[styles.line, { borderTopColor: colors.control }]}>
              <Text variant="strong" style={{ flex: 1 }}>
                Total
              </Text>
              <Text variant="h3">{formatLkr(d.totalCents)}</Text>
            </View>
          </Card>

          {d.status === 'draft' ? (
            <Button
              label="Mark as Reviewed"
              loading={review.isPending}
              onPress={() => review.mutate()}
            />
          ) : null}
          {d.status === 'reviewed' ? (
            <Button label="Mark as Paid" onPress={() => setPaying(true)} />
          ) : null}
          {d.checksum ? (
            <Text
              variant="small"
              selectable
            >{`Frozen · checksum ${d.checksum.slice(0, 16)}…`}</Text>
          ) : null}
          <Button
            variant="secondary"
            label="Share as CSV"
            loading={share.isPending}
            onPress={() => share.mutate()}
          />
        </>
      ) : null}

      <Sheet
        visible={paying}
        onClose={() => setPaying(false)}
        footer={
          <Button
            label={d ? `Mark ${formatLkr(d.totalCents)} Paid` : 'Mark Paid'}
            loading={pay.isPending}
            onPress={() => pay.mutate()}
          />
        }
      >
        <Text variant="h2">Has the money gone out?</Text>
        <Text variant="muted">
          Only mark it paid once the transfer is done. The statement is then frozen and can’t be
          changed.
        </Text>
        <TextField
          label="Bank reference (optional)"
          value={reference}
          onChangeText={setReference}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
