import { can, formatLkr, type AdminCustomerDetail } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
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
  Toggle,
} from '@/components';
import { colors } from '@/theme/tokens';

const STATUS: Record<string, string> = {
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  failed: 'Failed',
  active: 'In progress',
  picked_up: 'On the way',
  awaiting_restaurant: 'New',
  awaiting_payment: 'Awaiting payment',
};
const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Colombo',
  });

/** A18 detail: orders, refunds, open cases; flag, COD switch, block (owner). */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'customers.block');
  const queryClient = useQueryClient();
  const key = ['customer', id];
  const c = useQuery({ queryKey: key, queryFn: () => dispatchApi.customer(id) });
  const [sheet, setSheet] = useState<'flag' | 'block' | null>(null);
  const [text, setText] = useState('');
  const done = (d: AdminCustomerDetail) => {
    queryClient.setQueryData(key, d);
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    setSheet(null);
    setText('');
  };
  const flag = useMutation({
    mutationFn: (note: string | null) => dispatchApi.flagCustomer(id, note),
    onSuccess: done,
  });
  const cod = useMutation({
    mutationFn: (allowed: boolean) => dispatchApi.setCustomerCod(id, allowed),
    onSuccess: done,
  });
  const block = useMutation({
    mutationFn: (v: { blocked: boolean; reason?: string }) =>
      dispatchApi.blockCustomer(id, v.blocked, v.reason),
    onSuccess: done,
  });
  const d = c.data;
  const error = c.error ?? flag.error ?? cod.error ?? block.error;
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/customers'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
            {d?.name.trim() || 'Customer'}
          </Text>
          {d?.blocked ? <Chip label="Blocked" tone="danger" /> : null}
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
                <Text variant="strong">{d.phone ? localPhone(d.phone) : 'No phone'}</Text>
                <Text variant="small">{`Customer since ${when(d.joinedAt)}`}</Text>
              </View>
              {d.phone ? (
                <Button small variant="secondary" label="Call" onPress={() => call(d.phone!)} />
              ) : null}
            </View>
            <Text variant="small">
              {`${d.orders} orders · ${d.delivered} delivered · ${d.cancelled} cancelled · refunded ${formatLkr(d.refundedCents)} · ${d.openCases} open cases`}
            </Text>
          </Card>

          <Card tone={d.flagNote ? 'warn' : 'default'} style={{ gap: 6 }}>
            <Text variant="strong">Office note</Text>
            <Text variant="body">{d.flagNote ?? 'None'}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                small
                variant="secondary"
                label={d.flagNote ? 'Change' : 'Add Note'}
                onPress={() => setSheet('flag')}
              />
              {d.flagNote ? (
                <Button small variant="ghost" label="Clear" onPress={() => flag.mutate(null)} />
              ) : null}
            </View>
          </Card>

          <Card style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text variant="strong">Cash on delivery</Text>
              <Text variant="small">{d.codBlocked ? 'Off: bank transfer only' : 'Allowed'}</Text>
            </View>
            <Toggle
              label="Allow cash on delivery"
              value={!d.codBlocked}
              onChange={(on) => cod.mutate(on)}
            />
          </Card>

          <Text variant="label">Recent orders</Text>
          {d.recent.map((o) => (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              onPress={() => router.push(`/ticket/${o.id}`)}
              style={styles.order}
            >
              <View style={{ flex: 1 }}>
                <Text variant="strong">{`#${o.reference} · ${o.restaurantName}`}</Text>
                <Text variant="small">{`${when(o.placedAt)} · ${o.paymentMethod === 'cod' ? 'cash' : 'bank'}`}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="strong">{formatLkr(o.totalCents)}</Text>
                <Text variant="small">{STATUS[o.status] ?? o.status}</Text>
              </View>
            </Pressable>
          ))}

          {owner ? (
            d.blocked ? (
              <Button
                variant="secondary"
                label="Unblock"
                loading={block.isPending}
                onPress={() => block.mutate({ blocked: false })}
              />
            ) : (
              <Button variant="danger" label="Block Customer" onPress={() => setSheet('block')} />
            )
          ) : null}
        </>
      ) : null}

      <Sheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        footer={
          <Button
            variant={sheet === 'block' ? 'danger' : 'primary'}
            label={sheet === 'block' ? 'Block' : 'Save Note'}
            disabled={text.trim().length < 3}
            loading={flag.isPending || block.isPending}
            onPress={() =>
              sheet === 'block'
                ? block.mutate({ blocked: true, reason: text.trim() })
                : flag.mutate(text.trim())
            }
          />
        }
      >
        <Text variant="h2">{sheet === 'block' ? 'Block this customer?' : 'Office note'}</Text>
        <Text variant="muted">
          {sheet === 'block'
            ? 'They’re signed out at once and can’t sign in or order. Orders already placed carry on.'
            : 'Dispatch sees this whenever they look this customer up.'}
        </Text>
        <TextField
          label={sheet === 'block' ? 'Reason' : 'Note'}
          value={text}
          onChangeText={setText}
          multiline
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  order: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
