import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';
import { Alert } from './Alert';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { NavBar, type NavItem } from './NavBar';
import { Screen } from './Screen';
import { Text } from './Text';
import { Wordmark } from './Wordmark';

/** Stand-in home for a face until its milestone builds the real screens. */
export function FacePlaceholder({
  title,
  milestone,
  tabs,
}: {
  title: string;
  milestone: string;
  tabs: NavItem[];
}) {
  const account = useSession((s) => s.session?.account);
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const me = useQuery({ queryKey: ['me'], queryFn: authApi.me });

  return (
    <Screen
      top={<Wordmark size={20} />}
      footer={
        <NavBar
          active={active}
          items={tabs.map((t) => ({ ...t, onPress: () => setActive(t.key) }))}
        />
      }
    >
      <Text variant="h1" accessibilityRole="header">
        {title}
      </Text>
      <Card>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text variant="strong">{account?.displayName || 'Signed in'}</Text>
          <Chip
            tone={me.data ? 'green' : 'neutral'}
            label={me.data ? 'Connected' : me.isLoading ? 'Checking…' : 'Offline'}
          />
        </View>
        <Text variant="muted">Role: {account?.role.replace('_', ' ')}</Text>
        <Text variant="muted">{milestone} builds this part of the app.</Text>
      </Card>
      {me.error ? <Alert tone="danger" message={errorMessage(me.error)} /> : null}
      <Button variant="secondary" label="Sign Out" onPress={() => void signOut()} />
    </Screen>
  );
}
