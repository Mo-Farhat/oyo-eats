import { formatLkr, type RestaurantSummary } from '@oyo/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fonts } from '@/theme/tokens';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { Photo } from './Photo';
import { Text } from './Text';

/** C02 restaurant row: photo, name, cuisines, rating, ETA, delivery fee. Closed ones are dimmed. */
export function RestaurantCard({
  r,
  onPress,
  compact,
}: {
  r: RestaurantSummary;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}${r.isOpen ? '' : ', closed'}`}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.hit : styles.card,
        !r.isOpen && { opacity: 0.55 },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Photo size={compact ? 52 : 84} />
      <View style={styles.text}>
        <Text variant="strong">{r.name}</Text>
        {compact ? null : <Text variant="muted">{r.cuisines.join(' · ')}</Text>}
        {r.isOpen ? (
          <View style={styles.meta}>
            <View style={styles.rating}>
              <Icon name="star" size={14} color={colors.warn} />
              <Text style={styles.metaText}>{r.rating ?? 'New'}</Text>
            </View>
            <Text style={styles.metaText}>{`${r.eta.min}–${r.eta.max} min`}</Text>
            <Text
              style={[styles.metaText, { color: colors.brandSoft }]}
            >{`${formatLkr(r.deliveryFeeCents)} delivery`}</Text>
          </View>
        ) : (
          <Chip label="Closed now" />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 10,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hit: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  text: { flex: 1, gap: 4, justifyContent: 'center' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontFamily: fonts.sans400, fontSize: 12, color: colors.strong },
});
