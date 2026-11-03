import { formatLkr } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { MenuItemForm, rupeesToCents } from '@/admin/MenuItemForm';
import {
  Alert,
  Button,
  Card,
  Chip,
  IconButton,
  Photo,
  Screen,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { MENU, MENU_REQUESTS, useMenu } from '@/restaurant/queries';
import { colors } from '@/theme/tokens';

function NewItem() {
  const menu = useMenu();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: MENU });
    void queryClient.invalidateQueries({ queryKey: MENU_REQUESTS });
  };
  const addCategory = useMutation({
    mutationFn: () => restaurantApi.addCategory(category.trim()),
    onSuccess: () => {
      setCategory('');
      refresh();
    },
  });
  const add = useMutation({
    mutationFn: restaurantApi.addItem,
    onSuccess: () => {
      refresh();
      router.replace('/requests');
    },
  });
  const cats = menu.data?.categories ?? [];
  return (
    <>
      <Text variant="muted">
        New items go live once Oyo Eats approves them, usually within a few hours.
      </Text>
      {add.error || addCategory.error ? (
        <Alert tone="danger" message={errorMessage(add.error ?? addCategory.error)} />
      ) : null}
      <Card style={{ gap: 8 }}>
        <TextField
          label={cats.length ? 'New category (optional)' : 'First, a category'}
          hint="e.g. Kottu, Rice & Curry, Drinks"
          value={category}
          onChangeText={setCategory}
        />
        <Button
          small
          variant="secondary"
          label="Add Category"
          disabled={!category.trim()}
          loading={addCategory.isPending}
          onPress={() => addCategory.mutate()}
        />
      </Card>
      {cats.length ? (
        <MenuItemForm
          key={cats.length}
          title={null}
          categories={cats}
          busy={add.isPending}
          submitLabel="Submit for Approval"
          onSubmit={(input) => add.mutate(input)}
        />
      ) : null}
    </>
  );
}

function EditItem({ id }: { id: string }) {
  const menu = useMenu();
  const queryClient = useQueryClient();
  const cats = menu.data?.categories ?? [];
  const item = cats.flatMap((c) => c.items).find((i) => i.id === id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setDescription(item.description ?? '');
    setPrice(String(item.priceCents / 100));
    setCategoryId(item.categoryId);
  }, [item?.id]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: MENU });
    void queryClient.invalidateQueries({ queryKey: MENU_REQUESTS });
  };
  const change = useMutation({
    mutationFn: () => {
      const cents = rupeesToCents(price);
      return restaurantApi.requestChange(id, {
        ...(name.trim() !== item!.name && { name: name.trim() }),
        ...(description.trim() !== (item!.description ?? '') && {
          description: description.trim(),
        }),
        ...(cents !== item!.priceCents && { priceCents: cents }),
        ...(categoryId !== item!.categoryId && { categoryId }),
      });
    },
    onSuccess: () => {
      refresh();
      router.replace('/requests');
    },
  });
  const withdraw = useMutation({
    mutationFn: () => restaurantApi.withdraw(item!.pendingChange!.requestId),
    onSuccess: refresh,
  });
  const stock = useMutation({
    mutationFn: (soldOut: boolean) => restaurantApi.setStock(id, soldOut),
    onSuccess: refresh,
  });
  if (!item) return menu.data ? <Text variant="muted">This item has been removed.</Text> : null;

  const cents = rupeesToCents(price);
  const changed =
    name.trim() !== item.name ||
    description.trim() !== (item.description ?? '') ||
    cents !== item.priceCents ||
    categoryId !== item.categoryId;
  const submit = () => {
    if (!name.trim()) return setProblem('Give the item a name.');
    if (!Number.isFinite(cents) || cents < 100)
      return setProblem('Enter the price in rupees, e.g. 950.');
    setProblem(undefined);
    change.mutate();
  };
  const live = item.status === 'live';

  return (
    <>
      <View style={styles.head}>
        <Photo size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="small">Photos come with the next update.</Text>
          {live ? (
            <View style={styles.stock}>
              <Toggle label="In stock" value={!item.soldOut} onChange={(on) => stock.mutate(!on)} />
              <Text variant="body">{item.soldOut ? 'Sold out' : 'In stock'}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {item.status === 'pending' ? (
        <Alert
          tone="warn"
          message="This new item is waiting for Oyo Eats approval. Customers can’t see it yet."
        />
      ) : null}
      {item.status === 'rejected' ? (
        <Alert
          tone="danger"
          message="Oyo Eats didn’t approve this item. See the note under Change Requests, then add it again."
        />
      ) : null}
      {error(change.error ?? withdraw.error ?? stock.error)}

      {item.pendingChange ? (
        <Card tone="warn" style={{ gap: 6 }}>
          <Text variant="strong">Waiting for approval</Text>
          <Text variant="small">
            {[
              item.pendingChange.after.name !== item.name
                ? `Name → ${item.pendingChange.after.name}`
                : null,
              item.pendingChange.after.priceCents !== item.priceCents
                ? `Price ${formatLkr(item.priceCents)} → ${formatLkr(item.pendingChange.after.priceCents)}`
                : null,
              item.pendingChange.after.description !== item.description ? 'New description' : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Category change'}
          </Text>
          <Text variant="small">Customers see the live values until it’s approved.</Text>
          <Button
            small
            variant="ghost"
            label="Withdraw Change"
            loading={withdraw.isPending}
            onPress={() => withdraw.mutate()}
          />
        </Card>
      ) : live ? (
        <>
          <TextField label="Name" value={name} onChangeText={setName} />
          <TextField
            label="Description"
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
            style={cents !== item.priceCents ? { borderColor: colors.warn } : undefined}
          />
          {Number.isFinite(cents) && cents !== item.priceCents ? (
            <Text variant="small" style={{ color: colors.warn }}>
              {`Was ${formatLkr(item.priceCents)}. Customers keep seeing the old price until approved.`}
            </Text>
          ) : null}
          <Text variant="label">Category</Text>
          <View style={styles.chips}>
            {cats.map((c) => (
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
        </>
      ) : null}

      {item.groups.length ? (
        <Card style={{ gap: 6 }}>
          <Text variant="strong">Choices</Text>
          {item.groups.map((g) => (
            <Text key={g.id} variant="small">
              {`${g.name} · ${g.minSelect > 0 ? 'required' : 'optional'} · ${g.options
                .map((o) => (o.priceCents ? `${o.name} +${o.priceCents / 100}` : o.name))
                .join(' / ')}`}
            </Text>
          ))}
          <Text variant="small">To change choices, call the Oyo Eats office for now.</Text>
        </Card>
      ) : null}

      {problem ? <Alert tone="danger" message={problem} /> : null}
      {live && !item.pendingChange ? (
        <Button
          label="Submit for Approval"
          disabled={!changed}
          loading={change.isPending}
          onPress={submit}
        />
      ) : null}
    </>
  );
}

const error = (e: unknown) => (e ? <Alert tone="danger" message={errorMessage(e)} /> : null);

/** T08: add an item, or change a live one; changes wait for approval (RES-08). */
export default function Dish() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            {isNew ? 'Add Item' : 'Edit Item'}
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {isNew ? <NewItem /> : <EditItem id={id} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stock: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
