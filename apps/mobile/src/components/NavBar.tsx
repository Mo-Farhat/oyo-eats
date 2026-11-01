import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  onPress?: () => void;
}

/** Bottom tab bar from the design (76 px, bar surface, green active item). */
export function NavBar({ items, active }: { items: NavItem[]; active: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.nav, { paddingBottom: Math.max(14, insets.bottom) }]}
    >
      {items.map((item) => {
        const on = item.key === active;
        const color = on ? colors.brandSoft : colors.muted;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={item.onPress}
            style={styles.item}
          >
            <Icon name={item.icon} color={color} />
            <Text style={[styles.label, { color }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  item: { alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 60, minHeight: 48 },
  label: { fontFamily: fonts.sans700, fontSize: 11 },
});
