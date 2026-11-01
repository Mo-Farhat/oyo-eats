import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Alert, Chip, Icon, RestaurantCard, Screen, Text } from '@/components';
import { PILOT_TOWN } from '@/config';
import { useDeliveryAddress, useOrders, useRestaurants } from '@/customer/queries';
import { stageText } from '@/customer/stage';
import { errorMessage } from '@/api/messages';
import { colors, fonts } from '@/theme/tokens';

/** C02: where we deliver, search, cuisine filters, the active order, and restaurants. */
export default function Home() {
  const { address, isLoading: loadingAddress } = useDeliveryAddress();
  const [cuisine, setCuisine] = useState<string>();
  const all = useRestaurants();
  const filtered = useRestaurants(undefined, cuisine);
  const orders = useOrders();

  if (!loadingAddress && !address) return <Redirect href="/location" />;

  const list = (cuisine ? filtered.data : all.data) ?? [];
  const cuisines = [...new Set((all.data ?? []).flatMap((r) => r.cuisines))].sort();
  const open = list.filter((r) => r.isOpen);
  const closed = list.filter((r) => !r.isOpen);
  const active = orders.data?.find((o) => o.stage && o.stage !== 'delivered');
  const error = all.error ?? filtered.error;

  return (
    <Screen
      inTabs
      top={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change delivery address"
          onPress={() => router.push('/location')}
          style={styles.deliver}
        >
          <View style={styles.tile}>
            <Icon name="pin" color="#ffffff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="small">Deliver to · {address?.label ?? '…'}</Text>
            <Text variant="strong" numberOfLines={1}>
              {address?.addressText ?? 'Set your location'} ▾
            </Text>
          </View>
        </Pressable>
      }
      bodyStyle={{ gap: 14 }}
    >
      <Pressable
        accessibilityRole="search"
        onPress={() => router.navigate('/search')}
        style={styles.search}
      >
        <Icon name="search" color={colors.muted} />
        <Text style={styles.searchText}>Search kottu, biryani, cakes…</Text>
      </Pressable>

      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {[undefined, ...cuisines].map((c) => (
            <Pressable
              key={c ?? 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: cuisine === c }}
              onPress={() => setCuisine(c)}
            >
              <Chip label={c ?? 'All'} tone={cuisine === c ? 'on' : 'neutral'} />
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {active ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/order/${active.id}`)}
          style={styles.activeOrder}
        >
          <View style={styles.tile}>
            <Icon name="scooter" color="#ffffff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="strong">Order #{active.reference}</Text>
            <Text variant="muted">
              {active.restaurant.name} · {stageText(active.stage!, active.paymentMethod)}
            </Text>
          </View>
          <Icon name="chevron" />
        </Pressable>
      ) : null}

      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}

      <View style={styles.between}>
        <Text variant="h3" accessibilityRole="header">
          Open Now in {PILOT_TOWN.name}
        </Text>
        <Text variant="small">{open.length === 1 ? '1 place' : `${open.length} places`}</Text>
      </View>
      {open.map((r) => (
        <RestaurantCard key={r.id} r={r} onPress={() => router.push(`/restaurant/${r.id}`)} />
      ))}
      {!all.isLoading && list.length === 0 ? (
        <Text variant="muted">
          No restaurants deliver to this address yet. Try another address.
        </Text>
      ) : null}
      {closed.length ? (
        <>
          <Text variant="h3" accessibilityRole="header">
            Closed Now
          </Text>
          {closed.map((r) => (
            <RestaurantCard key={r.id} r={r} onPress={() => router.push(`/restaurant/${r.id}`)} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  deliver: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.bar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchText: { color: colors.muted, fontFamily: fonts.sans400, fontSize: 15 },
  chipRow: { height: 36 },
  chips: { gap: 8, alignItems: 'center' },
  activeOrder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.card,
  },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
