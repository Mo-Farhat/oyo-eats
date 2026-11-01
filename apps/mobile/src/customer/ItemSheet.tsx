import { formatLkr, type MenuItem } from '@oyo/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  Button,
  Checkbox,
  Chip,
  IconButton,
  Photo,
  Radio,
  Sheet,
  Stepper,
  Text,
  TextField,
} from '@/components';
import { colors } from '@/theme/tokens';
import type { CartModifier } from './store';

/** C05: options, a kitchen note and quantity for one item. Rules match the server's checks. */
export function ItemSheet({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onAdd: (line: { modifiers: CartModifier[]; quantity: number; note?: string }) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  useEffect(() => {
    // Start each item with the first available option picked in required single-choice groups.
    const start: Record<string, string[]> = {};
    for (const g of item?.groups ?? []) {
      const first = g.options.find((o) => !o.soldOut);
      start[g.id] = g.minSelect === 1 && g.maxSelect === 1 && first ? [first.id] : [];
    }
    setChosen(start);
    setQuantity(1);
    setNote('');
  }, [item]);

  if (!item)
    return (
      <Sheet visible={false} onClose={onClose}>
        {null}
      </Sheet>
    );

  const pick = (groupId: string, optionId: string, single: boolean, max: number) => {
    const current = chosen[groupId] ?? [];
    const next = single
      ? [optionId]
      : current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : current.length < max
          ? [...current, optionId]
          : current;
    setChosen({ ...chosen, [groupId]: next });
  };

  const selected = item.groups.flatMap((g) =>
    g.options.filter((o) => (chosen[g.id] ?? []).includes(o.id)),
  );
  const valid = item.groups.every((g) => {
    const n = (chosen[g.id] ?? []).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  const unit = item.priceCents + selected.reduce((sum, o) => sum + o.priceCents, 0);

  return (
    <Sheet
      visible
      tall
      onClose={onClose}
      footer={
        <View style={styles.footer}>
          <Stepper
            label="quantity"
            value={quantity}
            onChange={(v) => setQuantity(Math.max(1, v))}
          />
          <View style={{ flex: 1 }}>
            <Button
              label={`Add · ${formatLkr(unit * quantity)}`}
              disabled={!valid}
              onPress={() =>
                onAdd({
                  modifiers: selected.map((o) => ({
                    id: o.id,
                    name: o.name,
                    priceCents: o.priceCents,
                  })),
                  quantity,
                  note: note.trim() || undefined,
                })
              }
            />
          </View>
        </View>
      }
    >
      <Photo style={{ height: 150 }} />
      <View style={styles.title}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="h2" accessibilityRole="header">
            {item.name}
          </Text>
          {item.description ? <Text variant="muted">{item.description}</Text> : null}
          <Text variant="strong">{formatLkr(item.priceCents)}</Text>
        </View>
        <IconButton icon="close" label="Close" onPress={onClose} />
      </View>

      {item.groups.map((g) => {
        const single = g.maxSelect === 1;
        const required = g.minSelect > 0;
        return (
          <View key={g.id}>
            <View style={styles.between}>
              <Text variant="strong">{g.name}</Text>
              {required ? (
                <Chip label="Required" tone="warn" />
              ) : (
                <Text variant="small">{`Optional · up to ${g.maxSelect}`}</Text>
              )}
            </View>
            {g.options.map((o) => {
              const on = (chosen[g.id] ?? []).includes(o.id);
              const price = o.priceCents ? `+ ${formatLkr(o.priceCents)}` : '';
              const row = (
                <View style={[styles.option, o.soldOut && { opacity: 0.45 }]}>
                  {single ? <Radio on={on} /> : null}
                  <Text style={{ flex: 1 }}>{o.soldOut ? `${o.name} (sold out)` : o.name}</Text>
                  <Text>{price}</Text>
                </View>
              );
              return single ? (
                <Pressable
                  key={o.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: o.soldOut }}
                  disabled={o.soldOut}
                  onPress={() => pick(g.id, o.id, true, 1)}
                >
                  {row}
                </Pressable>
              ) : (
                <View key={o.id} style={styles.option}>
                  <Checkbox
                    checked={on}
                    label={o.name}
                    onChange={o.soldOut ? undefined : () => pick(g.id, o.id, false, g.maxSelect)}
                  >
                    <Text style={{ flex: 1 }}>{o.soldOut ? `${o.name} (sold out)` : o.name}</Text>
                  </Checkbox>
                  <Text>{price}</Text>
                </View>
              );
            })}
          </View>
        );
      })}

      <TextField
        label="Note for the kitchen"
        value={note}
        onChangeText={setNote}
        maxLength={200}
        placeholder="Less spicy please"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
