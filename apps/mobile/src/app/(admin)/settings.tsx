import { formatLkr, type AdminSettings } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  BottomBar,
  Button,
  Card,
  IconButton,
  Screen,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { colors } from '@/theme/tokens';

const rupees = (c: number | null) => (c === null ? '' : String(c / 100));
/** Form values as typed: rupees, km, minutes, seconds, percent. Blank optional = not set. */
const toForm = (s: AdminSettings) => ({
  base: rupees(s.deliveryFee.baseFeeCents),
  perKm: rupees(s.deliveryFee.perKmCents),
  radius: String(s.deliveryFee.maxRadiusMeters / 1000),
  minimum: rupees(s.minimumOrderCents),
  cod: rupees(s.codLimitCents),
  respond: String(s.timers.restaurantResponseSeconds / 60),
  offer: String(s.timers.offerSeconds),
  slip: String(s.timers.slipWindowSeconds / 60),
  unassigned: String(s.timers.unassignedAlertSeconds / 60),
  itemChange: String(s.timers.itemChangeSeconds / 60),
  jobs: String(s.riderCaps.maxActiveJobs),
  cashCap: rupees(s.riderCaps.cashCapCents),
  share: String(s.riderPay.platformShareBps / 100),
  refundCap: rupees(s.dispatcherRefundCapCents),
  bank: s.bankDetails ? 'on' : '',
  bankName: s.bankDetails?.bankName ?? '',
  branch: s.bankDetails?.branch ?? '',
  accountName: s.bankDetails?.accountName ?? '',
  accountNumber: s.bankDetails?.accountNumber ?? '',
});

type Form = ReturnType<typeof toForm>;

const num = (v: string) => Number(v.replace(/,/g, '').trim());
const cents = (v: string) => Math.round(num(v) * 100);
const optCents = (v: string) => (v.trim() ? cents(v) : null);
const fromForm = (f: Form): AdminSettings => ({
  deliveryFee: {
    baseFeeCents: cents(f.base),
    perKmCents: cents(f.perKm),
    maxRadiusMeters: Math.round(num(f.radius) * 1000),
  },
  timers: {
    restaurantResponseSeconds: Math.round(num(f.respond) * 60),
    offerSeconds: Math.round(num(f.offer)),
    slipWindowSeconds: Math.round(num(f.slip) * 60),
    unassignedAlertSeconds: Math.round(num(f.unassigned) * 60),
    itemChangeSeconds: Math.round(num(f.itemChange) * 60),
  },
  riderCaps: { maxActiveJobs: Math.round(num(f.jobs)), cashCapCents: cents(f.cashCap) },
  riderPay: { platformShareBps: Math.round(num(f.share) * 100) },
  minimumOrderCents: optCents(f.minimum),
  codLimitCents: optCents(f.cod),
  dispatcherRefundCapCents: optCents(f.refundCap),
  bankDetails: f.bank
    ? {
        bankName: f.bankName.trim(),
        branch: f.branch.trim(),
        accountName: f.accountName.trim(),
        accountNumber: f.accountNumber.trim(),
      }
    : null,
});

function Row({
  label,
  unit,
  value,
  onChange,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {hint ? <Text variant="small">{hint}</Text> : null}
      </View>
      <View style={{ width: 150 }}>
        <TextField label={unit} value={value} onChangeText={onChange} keyboardType="decimal-pad" />
      </View>
    </View>
  );
}

/** A20 (ADM-18): pricing, timers, caps and the business bank account. Applies to new orders. */
export default function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: dispatchApi.settings });
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (settings.data && !form) setForm(toForm(settings.data));
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => dispatchApi.saveSettings(fromForm(form!)),
    onSuccess: (s) => {
      queryClient.setQueryData(['admin-settings'], s);
      setForm(toForm(s));
      setSaved(true);
    },
  });
  const set = (k: keyof Form) => (v: string) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [k]: v } : f));
  };
  const f = form;
  const preview = f ? fromForm(f) : null;
  const example =
    preview && Number.isFinite(preview.deliveryFee.baseFeeCents + preview.deliveryFee.perKmCents)
      ? formatLkr(preview.deliveryFee.baseFeeCents + 3 * preview.deliveryFee.perKmCents)
      : '—';

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Settings
            </Text>
            <Text variant="small">Owner only · applies to new orders</Text>
          </View>
        </>
      }
      footer={
        f ? (
          <BottomBar>
            <Button
              label={saved ? 'Saved' : 'Save Changes'}
              loading={save.isPending}
              onPress={() => save.mutate()}
            />
          </BottomBar>
        ) : null
      }
      bodyStyle={{ gap: 12 }}
    >
      {settings.error || save.error ? (
        <Alert tone="danger" message={errorMessage(settings.error ?? save.error)} />
      ) : null}
      {saved ? (
        <Alert tone="green" message="Saved. New orders use these values from now on." />
      ) : null}
      {f ? (
        <>
          <Card style={styles.card}>
            <Text variant="label">Delivery pricing</Text>
            <Row label="Base fee" unit="LKR" value={f.base} onChange={set('base')} />
            <Row
              label="Per km"
              unit="LKR"
              value={f.perKm}
              onChange={set('perKm')}
              hint={`A 3 km trip costs ${example}`}
            />
            <Row label="Max radius" unit="km" value={f.radius} onChange={set('radius')} />
            <Row
              label="Minimum order"
              unit="LKR"
              value={f.minimum}
              onChange={set('minimum')}
              hint="Blank: no minimum"
            />
            <Row
              label="Cash on delivery limit"
              unit="LKR"
              value={f.cod}
              onChange={set('cod')}
              hint="Blank: no limit"
            />
          </Card>
          <Card style={styles.card}>
            <Text variant="label">Timers</Text>
            <Row
              label="Restaurant must respond"
              unit="min"
              value={f.respond}
              onChange={set('respond')}
            />
            <Row
              label="Rider offer rings for"
              unit="seconds"
              value={f.offer}
              onChange={set('offer')}
            />
            <Row label="Bank slip window" unit="min" value={f.slip} onChange={set('slip')} />
            <Row
              label="Unassigned alert after"
              unit="min"
              value={f.unassigned}
              onChange={set('unassigned')}
            />
            <Row
              label="Customer answers a sold-out item within"
              unit="min"
              value={f.itemChange}
              onChange={set('itemChange')}
            />
          </Card>
          <Card style={styles.card}>
            <Text variant="label">Riders and money</Text>
            <Row
              label="Active orders per rider"
              unit="orders"
              value={f.jobs}
              onChange={set('jobs')}
            />
            <Row
              label="Cash a rider may hold"
              unit="LKR"
              value={f.cashCap}
              onChange={set('cashCap')}
            />
            <Row
              label="Oyo Eats share of the delivery fee"
              unit="%"
              value={f.share}
              onChange={set('share')}
              hint="The rider gets the rest"
            />
            <Row
              label="Dispatcher refund cap"
              unit="LKR"
              value={f.refundCap}
              onChange={set('refundCap')}
              hint="Blank: every refund needs the owner"
            />
            <View style={styles.row}>
              <Text variant="body" style={{ flex: 1 }}>
                Payout cycle
              </Text>
              <Text variant="strong">Weekly · Monday</Text>
            </View>
          </Card>
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="label">Business bank account</Text>
                <Text variant="small">
                  Shown to customers paying by bank transfer. Off: no bank transfer.
                </Text>
              </View>
              <Toggle
                label="Accept bank transfers"
                value={!!f.bank}
                onChange={(on) => set('bank')(on ? 'on' : '')}
              />
            </View>
            {f.bank ? (
              <>
                <TextField label="Bank" value={f.bankName} onChangeText={set('bankName')} />
                <TextField label="Branch" value={f.branch} onChangeText={set('branch')} />
                <TextField
                  label="Account name"
                  value={f.accountName}
                  onChangeText={set('accountName')}
                />
                <TextField
                  label="Account number"
                  value={f.accountNumber}
                  onChangeText={set('accountNumber')}
                  keyboardType="number-pad"
                />
              </>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
