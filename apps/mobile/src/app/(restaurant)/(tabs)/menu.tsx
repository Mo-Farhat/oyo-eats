import { formatLkr, type RestaurantMenuItem } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Chip, Icon, IconButton, Photo, Screen, Text, Toggle } from '@/components';
import { MENU, useMenu } from '@/restaurant/queries';
import { colors } from '@/theme/tokens';

function badge(i: RestaurantMenuItem) {
  if (i.status === 'pending') return { label: 'Awaiting approval', tone: 'warn' as const };
  if (i.status === 'rejected') return { label: 'Not approved', tone: 'danger' as const };
  if (i.pendingChange) return { label: 'Change pending', tone: 'warn' as const };
  if (i.soldOut) return { label: 'Sold out', tone: 'danger' as const };
  return { label: 'Live', tone: 'green' as const };
}

function ItemRow({
  item,
  onStock,
}: {
  item: RestaurantMenuItem;
  onStock: (soldOut: boolean) => void;
}) {
  const b = badge(item);
  const extras = item.groups.length
    ? ` · ${item.groups.map((g) => `${g.options.length} ${g.name.toLowerCase()}`).join(' · ')}`
    : '';
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit ${item.name}`}
        onPress={() => router.push(`/dish/${item.id}`)}
        style={styles.rowMain}
      >
        <Photo size={56} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="strong">{item.name}</Text>
          <Text variant="small" numberOfLines={1}>{`${formatLkr(item.priceCents)}${extras}`}</Text>
          <Chip label={b.label} tone={b.tone} style={{ alignSelf: 'flex-start' }} />
        </View>
      </Pressable>
      {item.status === 'live' ? (
        <Toggle
          label={`${item.name} in stock`}
          value={!item.soldOut}
          onChange={(on) => onStock(!on)}
        />
      ) : null}
    </View>
  );
}

/** T07: the menu by category, stock switches, and the way into changes (RES-08). */
export default function Menu() {
  const menu = useMenu();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string>();
  const stock = useMutation({
    mutationFn: (v: { id: string; soldOut: boolean }) => restaurantApi.setStock(v.id, v.soldOut),
    onMutate: (v) => {
      // Instant on screen; the server agrees a moment later.
      queryClient.setQueryData(
        MENU,
        (m: typeof menu.data) =>
          m && {
            ...m,
            categories: m.categories.map((c) => ({
              ...c,
              items: c.items.map((i) => (i.id === v.id ? { ...i, soldOut: v.soldOut } : i)),
            })),
          },
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: MENU }),
  });
  const cats = menu.data?.categories ?? [];
  const current = cats.find((c) => c.id === active) ?? cats[0];

  return (
    <Screen inTabs bodyStyle={{ gap: 12, paddingTop: 24 }}>
      <View style={styles.between}>
        <Text variant="h1" accessibilityRole="header">
          Menu
        </Text>
        <IconButton icon="plus" green label="Add item" onPress={() => router.push('/dish/new')} />
      </View>
      {menu.error || stock.error ? (
        <Alert tone="danger" message={errorMessage(menu.error ?? stock.error)} />
      ) : null}
      {menu.data?.pendingRequests ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/requests')}
          style={styles.pending}
        >
          <Icon name="bell" size={18} color={colors.warn} />
          <Text variant="strong" style={{ flex: 1, color: colors.warn }}>
            {`${menu.data.pendingRequests} ${menu.data.pendingRequests === 1 ? 'change' : 'changes'} waiting for Oyo Eats approval`}
          </Text>
          <Icon name="chevron" size={18} color={colors.warn} />
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => router.push('/requests')}>
          <Text variant="small" style={{ color: colors.brandSoft }}>
            Change requests →
          </Text>
        </Pressable>
      )}
      {cats.length ? (
        <View style={{ height: 44 }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {cats.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: c.id === current?.id }}
                onPress={() => setActive(c.id)}
              >
                <Chip
                  label={`${c.name} ${c.items.length}`}
                  tone={c.id === current?.id ? 'on' : 'neutral'}
                />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {menu.data && !cats.length ? (
        <Text variant="muted">No menu yet. Tap + to add a category and your first item.</Text>
      ) : null}
      <View>
        {current?.items.map((i) => (
          <ItemRow key={i.id} item={i} onStock={(soldOut) => stock.mutate({ id: i.id, soldOut })} />
        ))}
        {current && current.items.length === 0 ? (
          <Text variant="muted">No items in this category yet.</Text>
        ) : null}
      </View>
      <Text variant="small">
        Stock switches work instantly. New items and changes to name, price or description go live
        once Oyo Eats approves them.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.warnTint,
  },
  tabs: { gap: 8, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
