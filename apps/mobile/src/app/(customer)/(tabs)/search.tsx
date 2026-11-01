import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Chip, Icon, RestaurantCard, Screen, Text } from '@/components';
import { useRestaurants } from '@/customer/queries';
import { useCustomer } from '@/customer/store';
import { colors, fonts } from '@/theme/tokens';

const FILTERS = [
  { key: 'open', label: 'Open now' },
  { key: 'rated', label: 'Rating 4+' },
  { key: 'cheap', label: 'Delivery under LKR 300' },
] as const;

/** C03: search restaurants and dishes (the API matches restaurant names, cuisines and dish names). */
export default function Search() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Set<string>>(new Set(['open']));
  const recent = useCustomer((s) => s.recentSearches);
  const remember = useCustomer((s) => s.rememberSearch);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const results = useRestaurants(q || undefined);
  const hits = (q ? (results.data ?? []) : []).filter(
    (r) =>
      (!filters.has('open') || r.isOpen) &&
      (!filters.has('rated') || (r.rating ?? 0) >= 4) &&
      (!filters.has('cheap') || r.deliveryFeeCents < 30_000),
  );

  const toggle = (key: string) => {
    const next = new Set(filters);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFilters(next);
  };

  return (
    <Screen
      inTabs
      top={
        <View style={styles.input}>
          <Icon name="search" size={16} color={colors.muted} />
          <TextInput
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => remember(text)}
            placeholder="Search kottu, biryani, cakes…"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Search"
            autoFocus
            returnKeyType="search"
            style={styles.field}
          />
        </View>
      }
      bodyStyle={{ gap: 14 }}
    >
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            accessibilityState={{ selected: filters.has(f.key) }}
            onPress={() => toggle(f.key)}
          >
            <Chip label={f.label} tone={filters.has(f.key) ? 'on' : 'neutral'} />
          </Pressable>
        ))}
      </View>

      {q ? (
        <View>
          <Text variant="label">Restaurants</Text>
          {hits.map((r) => (
            <RestaurantCard
              key={r.id}
              compact
              r={r}
              onPress={() => {
                remember(q);
                router.push(`/restaurant/${r.id}`);
              }}
            />
          ))}
          {!results.isFetching && hits.length === 0 ? (
            <Text variant="muted">Nothing matches “{q}” nearby.</Text>
          ) : null}
        </View>
      ) : recent.length ? (
        <View style={{ gap: 8 }}>
          <Text variant="label">Recent searches</Text>
          <View style={styles.chips}>
            {recent.map((r) => (
              <Pressable key={r} accessibilityRole="button" onPress={() => setText(r)}>
                <Chip label={r} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <Text variant="muted">Search for a restaurant, a cuisine or a dish.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.bar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  field: { flex: 1, color: colors.strong, fontFamily: fonts.sans400, fontSize: 15, height: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
