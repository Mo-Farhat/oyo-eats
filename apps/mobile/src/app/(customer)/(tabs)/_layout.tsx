import { Tabs } from 'expo-router';
import { NavBar, type NavItem } from '@/components';
import { colors } from '@/theme/tokens';

const TABS: Omit<NavItem, 'onPress'>[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'search', label: 'Search', icon: 'search' },
  { key: 'orders', label: 'Orders', icon: 'list' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

/** Customer tabs with the design's bottom nav (C02, C03, C13, C15). */
export default function CustomerTabs() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
      tabBar={({ state, navigateToTab }) => (
        <NavBar
          active={state.routes[state.index]?.name ?? 'home'}
          items={TABS.map((t) => ({
            ...t,
            onPress: () => {
              const route = state.routes.find((r) => r.name === t.key);
              if (route) navigateToTab(route.key);
            },
          }))}
        />
      )}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.key} name={t.key} />
      ))}
    </Tabs>
  );
}
