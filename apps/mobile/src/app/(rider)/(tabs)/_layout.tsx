import { Tabs } from 'expo-router';
import { NavBar, type NavItem } from '@/components';
import { OfferAlert } from '@/rider/OfferAlert';
import { useRiderState } from '@/rider/queries';
import { useLocationReporting } from '@/rider/useLocationReporting';
import { colors } from '@/theme/tokens';

const TABS: Omit<NavItem, 'onPress'>[] = [
  { key: 'rider', label: 'Home', icon: 'home' },
  { key: 'cash', label: 'Cash', icon: 'cash' },
  { key: 'earnings', label: 'Earnings', icon: 'star' },
  { key: 'profile', label: 'Profile', icon: 'user' },
];

/** Rider tabs. Offers ring over every tab; location reports run while online. */
export default function RiderTabs() {
  const state = useRiderState();
  useLocationReporting(state.data?.online ?? false, (state.data?.jobs.length ?? 0) > 0);
  return (
    <>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
        tabBar={({ state: nav, navigateToTab }) => (
          <NavBar
            active={nav.routes[nav.index]?.name ?? 'rider'}
            items={TABS.map((t) => ({
              ...t,
              onPress: () => {
                const route = nav.routes.find((r) => r.name === t.key);
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
      <OfferAlert offer={state.data?.offer ?? null} />
    </>
  );
}
