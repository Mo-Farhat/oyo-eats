import { Tabs } from 'expo-router';
import { NavBar, type NavItem } from '@/components';
import { colors } from '@/theme/tokens';

const TABS: Omit<NavItem, 'onPress'>[] = [
  { key: 'admin', label: 'Orders', icon: 'list' },
  { key: 'map', label: 'Map', icon: 'pin' },
  { key: 'riders', label: 'Riders', icon: 'scooter' },
  { key: 'restaurants', label: 'Restaurants', icon: 'home' },
  { key: 'more', label: 'More', icon: 'user' },
];

/** Admin and dispatch tabs (A01, A07, A08, A13, A21). */
export default function AdminTabs() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
      tabBar={({ state, navigateToTab }) => (
        <NavBar
          active={state.routes[state.index]?.name ?? 'admin'}
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
