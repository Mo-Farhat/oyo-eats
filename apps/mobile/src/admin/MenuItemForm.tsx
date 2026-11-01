import type { MenuItemInput } from '@oyo/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Alert, Button, Chip, Text, TextField } from '@/components';

/** "1,250" or "1250.50" rupees to cents; NaN when it isn't a number. */
export const rupeesToCents = (s: string) => Math.round(Number(s.replace(/,/g, '').trim()) * 100);

/**
 * A menu item entered by the owner, approved at once (ADM-12). One optional choice group, written
 * as one option per line, "Name = extra price" (e.g. "Large = 300").
 */
export function MenuItemForm({
  categories,
  busy,
  onSubmit,
}: {
  categories: { id: string; name: string }[];
  busy: boolean;
  onSubmit: (input: MenuItemInput) => void;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [groupName, setGroupName] = useState('');
  const [required, setRequired] = useState(true);
  const [options, setOptions] = useState('');
  const [problem, setProblem] = useState<string>();

  const submit = () => {
    const priceCents = rupeesToCents(price);
    if (!categoryId) return setProblem('Add a category first.');
    if (!name.trim()) return setProblem('Give the item a name.');
    if (!Number.isFinite(priceCents) || priceCents < 100)
      return setProblem('Enter the price in rupees, e.g. 950.');
    const lines = options
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed = lines.map((l) => {
      const [n, p] = l.split('=').map((x) => x.trim());
      return { name: n ?? '', priceCents: p ? rupeesToCents(p) : 0 };
    });
    if (parsed.some((o) => !o.name || !Number.isFinite(o.priceCents) || o.priceCents < 0))
      return setProblem('Write each option as "Name = extra price", e.g. "Large = 300".');
    if (lines.length && !groupName.trim())
      return setProblem('Name the choice, e.g. "Size" or "Spice level".');
    setProblem(undefined);
    onSubmit({
      categoryId,
      name: name.trim(),
      description: description.trim() || undefined,
      priceCents,
      dietaryTags: [],
      groups: lines.length
        ? [{ name: groupName.trim(), minSelect: required ? 1 : 0, maxSelect: 1, options: parsed }]
        : [],
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text variant="h2">Add Menu Item</Text>
      <Text variant="label">Category</Text>
      <View style={styles.chips}>
        {categories.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: c.id === categoryId }}
            onPress={() => setCategoryId(c.id)}
          >
            <Chip label={c.name} tone={c.id === categoryId ? 'on' : 'neutral'} />
          </Pressable>
        ))}
      </View>
      <TextField label="Name" value={name} onChangeText={setName} />
      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <TextField
        label="Price"
        prefix="LKR"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <Text variant="h3">Choice (optional)</Text>
      <TextField
        label="Choice name"
        hint="e.g. Size"
        value={groupName}
        onChangeText={setGroupName}
      />
      <TextField
        label="Options"
        hint={'One per line: "Regular = 0", "Large = 300".'}
        value={options}
        onChangeText={setOptions}
        multiline
        autoCapitalize="words"
      />
      <View style={styles.chips}>
        {[true, false].map((r) => (
          <Pressable
            key={String(r)}
            accessibilityRole="radio"
            accessibilityState={{ checked: required === r }}
            onPress={() => setRequired(r)}
          >
            <Chip
              label={r ? 'Must pick one' : 'Optional'}
              tone={required === r ? 'on' : 'neutral'}
            />
          </Pressable>
        ))}
      </View>
      {problem ? <Alert tone="danger" message={problem} /> : null}
      <Button label="Add Item" loading={busy} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
