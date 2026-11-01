import { formatLkr, type MenuItem } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { customerApi } from '@/api';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  BottomBar,
  Button,
  Chip,
  ConfirmSheet,
  IconButton,
  Photo,
  Text,
  Card,
  Stars,
} from '@/components';
import { ItemSheet } from '@/customer/ItemSheet';
import { useRestaurant } from '@/customer/queries';
import { cartCount, cartSubtotal, useCustomer, type CartModifier } from '@/customer/store';
import { colors, fonts } from '@/theme/tokens';

/** C04: the restaurant and its menu by category. */
export default function RestaurantScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const restaurant = useRestaurant(id);
  const reviews = useQuery({ queryKey: ['reviews', id], queryFn: () => customerApi.reviews(id) });
  const cart = useCustomer();
  const [item, setItem] = useState<MenuItem | null>(null);
  const [pending, setPending] = useState<{
    item: MenuItem;
    modifiers: CartModifier[];
    quantity: number;
    note?: string;
  } | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<Record<string, number>>({});

  const r = restaurant.data;
  const inCart = cart.restaurantId === id ? cart.lines : [];

  const add = (
    target: MenuItem,
    line: { modifiers: CartModifier[]; quantity: number; note?: string },
  ) => {
    cart.add(
      { id: r!.id, name: r!.name },
      { menuItemId: target.id, name: target.name, unitPriceCents: target.priceCents, ...line },
    );
    setItem(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <ScrollView
        ref={scroll}
        stickyHeaderIndices={[2]}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View style={styles.cover}>
          <Photo
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 0 }}
          />
          <SafeAreaView edges={['top']} style={styles.coverButtons}>
            <IconButton icon="back" label="Back" onPress={() => router.back()} />
          </SafeAreaView>
        </View>

        <View style={styles.head}>
          {restaurant.error ? (
            <Alert tone="danger" message={errorMessage(restaurant.error)} />
          ) : null}
          {r ? (
            <>
              <View style={styles.between}>
                <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
                  {r.name}
                </Text>
                <Chip label={r.isOpen ? 'Open' : 'Closed'} tone={r.isOpen ? 'green' : 'neutral'} />
              </View>
              <Text variant="muted">{[...r.cuisines, r.addressText].join(' · ')}</Text>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{r.rating ?? 'New'}</Text>
                  <Text style={styles.statKey}>
                    {r.ratingCount ? `${r.ratingCount} ratings` : 'No ratings yet'}
                  </Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {r.eta ? `${r.eta.min}–${r.eta.max} min` : '—'}
                  </Text>
                  <Text style={styles.statKey}>To your door</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {r.deliveryFeeCents !== null ? formatLkr(r.deliveryFeeCents) : '—'}
                  </Text>
                  <Text style={styles.statKey}>
                    {r.distanceMeters !== null
                      ? `Delivery · ${(r.distanceMeters / 1000).toFixed(1)} km`
                      : 'Delivery'}
                  </Text>
                </View>
              </View>
              {!r.isOpen ? (
                <Alert message="Closed now. You can look at the menu, but ordering opens when they do." />
              ) : null}
            </>
          ) : null}
        </View>

        <View style={styles.tabsWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {r?.categories.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeCategory === c.id }}
                onPress={() => {
                  setActiveCategory(c.id);
                  scroll.current?.scrollTo({
                    y: (offsets.current[c.id] ?? 0) - 56,
                    animated: true,
                  });
                }}
                style={[styles.tab, activeCategory === c.id && styles.tabOn]}
              >
                <Text style={[styles.tabText, activeCategory === c.id && { color: colors.strong }]}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          {r?.categories.map((c) => (
            <View key={c.id} onLayout={(e) => (offsets.current[c.id] = e.nativeEvent.layout.y + 0)}>
              <Text variant="h3" style={{ marginTop: 16 }}>
                {c.name}
              </Text>
              {c.items.map((i) => (
                <Pressable
                  key={i.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${i.name}, ${formatLkr(i.priceCents)}${i.soldOut ? ', sold out' : ''}`}
                  disabled={i.soldOut || !r.isOpen}
                  onPress={() => setItem(i)}
                  style={[styles.item, i.soldOut && { opacity: 0.5 }]}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="strong">{i.name}</Text>
                    {i.description ? <Text variant="muted">{i.description}</Text> : null}
                    {i.soldOut ? (
                      <Chip label="Sold out today" tone="danger" />
                    ) : (
                      <Text variant="strong">
                        {i.groups.length
                          ? `from ${formatLkr(i.priceCents)}`
                          : formatLkr(i.priceCents)}
                      </Text>
                    )}
                  </View>
                  <Photo size={80} />
                </Pressable>
              ))}
            </View>
          ))}
        </View>
        {reviews.data?.length ? (
          <View style={{ paddingHorizontal: 20, gap: 10, marginTop: 24 }}>
            <Text variant="h3" accessibilityRole="header">
              Reviews
            </Text>
            {reviews.data.map((rv, i) => (
              <Card key={i} style={{ gap: 6 }}>
                <View style={styles.between}>
                  <Text variant="strong" style={{ flex: 1 }}>
                    {rv.author}
                  </Text>
                  <Stars label={`${rv.author}'s rating`} value={rv.rating} size={16} />
                </View>
                {rv.tags.length ? <Text variant="small">{rv.tags.join(' · ')}</Text> : null}
                {rv.body ? <Text>{rv.body}</Text> : null}
                {rv.reply ? (
                  <Text variant="muted">{`Reply from ${r?.name}: ${rv.reply}`}</Text>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {inCart.length ? (
        <BottomBar>
          <Button
            label="View Cart"
            onPress={() => router.push('/cart')}
            trailing={<Text style={styles.cartTotal}>{formatLkr(cartSubtotal(inCart))}</Text>}
            accessibilityLabel={`View cart, ${cartCount(inCart)} items`}
          />
        </BottomBar>
      ) : null}

      <ItemSheet
        item={item}
        onClose={() => setItem(null)}
        onAdd={(line) => {
          if (cart.restaurantId && cart.restaurantId !== id && cart.lines.length) {
            setPending({ item: item!, ...line });
            setItem(null);
          } else add(item!, line);
        }}
      />
      <ConfirmSheet
        visible={!!pending}
        title="Start a New Cart?"
        message={`Your cart has items from ${cart.restaurantName}. One restaurant per order, so adding this clears that cart.`}
        confirmLabel="Start New Cart"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          cart.clear();
          if (pending) add(pending.item, pending);
          setPending(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { height: 170 },
  coverButtons: { position: 'absolute', top: 0, left: 20, paddingTop: 20 },
  head: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 16,
    padding: 10,
    gap: 2,
  },
  statValue: { fontFamily: fonts.display600, fontSize: 15, lineHeight: 20, color: colors.strong },
  statKey: { fontFamily: fonts.sans600, fontSize: 11, lineHeight: 15, color: colors.muted },
  tabsWrap: { backgroundColor: colors.page, paddingVertical: 10 },
  tabs: { gap: 6, paddingHorizontal: 20 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.bar,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: colors.raise },
  tabText: { fontFamily: fonts.sans700, fontSize: 13, color: colors.muted },
  item: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cartTotal: { fontFamily: fonts.display700, fontSize: 18, color: colors.onBrand },
});
