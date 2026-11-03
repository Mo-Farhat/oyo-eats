import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Chip, IconButton, Screen, Text } from '@/components';
import { colors } from '@/theme/tokens';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'refund.', label: 'Refunds' },
  { value: 'settings.', label: 'Settings' },
  { value: 'settlement', label: 'Payouts' },
  { value: 'cash.', label: 'Cash' },
  { value: 'account.', label: 'Logins' },
  { value: 'customer.', label: 'Customers' },
  { value: 'menu.', label: 'Menu' },
];
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

/** SEC-31: who changed what, newest first. Read-only; entries can't be edited or deleted. */
export default function Audit() {
  const [filter, setFilter] = useState('');
  const list = useQuery({
    queryKey: ['audit', filter],
    queryFn: () => dispatchApi.audit(filter || undefined),
  });
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Audit Log
          </Text>
        </>
      }
      bodyStyle={{ gap: 8 }}
    >
      <View style={{ height: 44 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, alignItems: 'center' }}
        >
          {FILTERS.map((f) => (
            <Pressable
              key={f.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: f.value === filter }}
              onPress={() => setFilter(f.value)}
            >
              <Chip label={f.label} tone={f.value === filter ? 'on' : 'neutral'} />
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {list.error ? <Alert tone="danger" message={errorMessage(list.error)} /> : null}
      {list.data?.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="strong" style={{ flex: 1 }}>
              {e.action}
            </Text>
            <Text variant="small">{when(e.at)}</Text>
          </View>
          <Text variant="small">{`${e.actor} (${e.role}) · ${e.target}`}</Text>
          {e.details ? (
            <Text variant="small" numberOfLines={2} style={{ color: colors.body }}>
              {JSON.stringify(e.details)}
            </Text>
          ) : null}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
});
