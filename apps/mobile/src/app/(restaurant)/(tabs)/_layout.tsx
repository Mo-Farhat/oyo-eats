import { Tabs } from 'expo-router';
import { NavBar, type NavItem } from '@/components';
import { NewOrderAlert } from '@/restaurant/NewOrderAlert';
import { colors } from '@/theme/tokens';

const TABS: Omit<NavItem, 'onPress'>[] = [
  { key: 'restaurant', label: 'Orders', icon: 'list' },
  { key: 'menu', label: 'Menu', icon: 'home' },
  { key: 'payouts', label: 'Payouts', icon: 'cash' },
  { key: 'more', label: 'More', icon: 'user' },
];

/** Restaurant tabs (T01, T07, T11, T12). The new-order alarm sits over every tab. */
export default function RestaurantTabs() {
  return (
    <>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
        tabBar={({ state, navigateToTab }) => (
          <NavBar
            active={state.routes[state.index]?.name ?? 'restaurant'}
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
      <NewOrderAlert />
    </>
  );
}
