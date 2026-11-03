import type { AdminCustomerSummary } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { localPhone } from '@/call';
import { Alert, Chip, Icon, IconButton, Screen, Text, TextField } from '@/components';
import { colors } from '@/theme/tokens';

function Row({ c }: { c: AdminCustomerSummary }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/customer/${c.id}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="strong">{c.name.trim() || 'No name'}</Text>
        <Text variant="small">
          {[c.phone ? localPhone(c.phone) : null, `${c.orders} orders`].filter(Boolean).join(' · ')}
        </Text>
        {c.flagNote ? (
          <Text variant="small" style={{ color: colors.warn }} numberOfLines={1}>
            {`⚑ ${c.flagNote}`}
          </Text>
        ) : null}
      </View>
      {c.blocked ? (
        <Chip label="Blocked" tone="danger" />
      ) : c.codBlocked ? (
        <Chip label="No COD" tone="warn" />
      ) : null}
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A18 (ADM-15): search by phone (any local format) or name; recent customers by default. */
export default function Customers() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ['customers', debounced],
    queryFn: () => dispatchApi.customers(debounced),
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
            Customers
          </Text>
        </>
      }
      bodyStyle={{ gap: 10 }}
    >
      <TextField
        label="Search"
        placeholder="077 123 4567 or a name"
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      {list.error ? <Alert tone="danger" message={errorMessage(list.error)} /> : null}
      {!debounced.trim() ? <Text variant="label">Ordered in the last 7 days</Text> : null}
      {list.data?.map((c) => (
        <Row key={c.id} c={c} />
      ))}
      {list.data && list.data.length === 0 ? <Text variant="muted">No customer found.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
