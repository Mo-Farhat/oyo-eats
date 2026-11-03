import {
  formatLkr,
  REFUND_REASON_LABELS,
  REFUND_REASONS,
  type RefundAttribution,
  type RefundInput,
  type RefundReason,
} from '@oyo/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Alert, Button, Chip, Text, TextField } from '@/components';
import { rupeesToCents } from './MenuItemForm';

const WHO: { value: RefundAttribution; label: string; hint: string }[] = [
  { value: 'restaurant', label: 'Restaurant', hint: 'Comes off their next statement' },
  { value: 'rider', label: 'Rider', hint: 'Comes off their next payout' },
  { value: 'oyo', label: 'Oyo Eats', hint: 'We absorb it' },
];

/** ADM-16: amount, reason code and who bears it. The API applies the dispatcher cap. */
export function RefundForm({
  refundableCents,
  hasRider,
  busy,
  onSubmit,
  defaultReason = 'missing_item',
}: {
  refundableCents: number;
  hasRider: boolean;
  busy: boolean;
  onSubmit: (input: RefundInput) => void;
  defaultReason?: RefundReason;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>(defaultReason);
  const [who, setWho] = useState<RefundAttribution>('restaurant');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string>();
  const submit = () => {
    const cents = rupeesToCents(amount);
    if (!Number.isFinite(cents) || cents < 100) return setProblem('Enter the amount in rupees.');
    if (cents > refundableCents)
      return setProblem(`At most ${formatLkr(refundableCents)} can be refunded.`);
    setProblem(undefined);
    onSubmit({
      amountCents: cents,
      reasonCode: reason,
      attribution: who,
      note: note.trim() || undefined,
    });
  };
  return (
    <View style={{ gap: 10 }}>
      <TextField
        label="Amount"
        prefix="LKR"
        hint={`Up to ${formatLkr(refundableCents)}`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
      />
      <Text variant="label">Reason</Text>
      <View style={styles.chips}>
        {REFUND_REASONS.map((r) => (
          <Pressable
            key={r}
            accessibilityRole="radio"
            accessibilityState={{ checked: r === reason }}
            onPress={() => setReason(r)}
          >
            <Chip label={REFUND_REASON_LABELS[r]} tone={r === reason ? 'on' : 'neutral'} />
          </Pressable>
        ))}
      </View>
      <Text variant="label">Who bears it</Text>
      <View style={styles.chips}>
        {WHO.filter((w) => w.value !== 'rider' || hasRider).map((w) => (
          <Pressable
            key={w.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: w.value === who }}
            onPress={() => setWho(w.value)}
          >
            <Chip label={w.label} tone={w.value === who ? 'on' : 'neutral'} />
          </Pressable>
        ))}
      </View>
      <Text variant="small">{WHO.find((w) => w.value === who)?.hint}</Text>
      <TextField label="Note (optional)" value={note} onChangeText={setNote} />
      {problem ? <Alert tone="danger" message={problem} /> : null}
      <Button label="Issue Refund" loading={busy} onPress={submit} />
      <Text variant="small">
        Refunds are transferred by the office, never handed over as cash by a rider.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
