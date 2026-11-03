import { CASE_LABELS, URGENT_CASES, type CaseType, type SupportCase } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Chip, Icon, IconButton, Screen, Segmented, Text } from '@/components';
import { colors } from '@/theme/tokens';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 60
    ? `${m} min ago`
    : m < 1440
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} d ago`;
};

function Row({ c }: { c: SupportCase }) {
  const urgent = URGENT_CASES.includes(c.type as CaseType);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/case/${c.id}`)}
      style={({ pressed }) => [styles.row, urgent && styles.urgent, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Text variant="strong">{CASE_LABELS[c.type as CaseType] ?? c.type}</Text>
          {c.status === 'in_progress' ? <Chip label="In progress" tone="info" /> : null}
        </View>
        <Text variant="small" numberOfLines={1}>
          {[
            c.order ? `#${c.order.reference} · ${c.order.restaurantName}` : null,
            `${c.reporter.name} (${c.reporter.role})`,
            ago(c.createdAt),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {c.description ? (
          <Text variant="small" numberOfLines={1}>
            {c.description}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A22: support cases, oldest open first; emergencies stand out. */
export default function Support() {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const list = useQuery({
    queryKey: ['cases', status],
    queryFn: () => dispatchApi.cases(status),
    refetchInterval: 15_000,
  });
  const rows = list.data ?? [];
  const urgent = rows.filter((c) => URGENT_CASES.includes(c.type as CaseType));
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
            Support
          </Text>
        </>
      }
      bodyStyle={{ gap: 10 }}
    >
      <Segmented
        options={[
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
        ]}
        value={status}
        onChange={setStatus}
      />
      {list.error ? <Alert tone="danger" message={errorMessage(list.error)} /> : null}
      {status === 'open' && urgent.length ? (
        <Alert
          tone="danger"
          message={`${urgent.length} rider emergency${urgent.length === 1 ? '' : 'ies'} open. Call now.`}
        />
      ) : null}
      {[...urgent, ...rows.filter((c) => !urgent.includes(c))].map((c) => (
        <Row key={c.id} c={c} />
      ))}
      {list.data && rows.length === 0 ? <Text variant="muted">Nothing here.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  urgent: { borderColor: colors.dangerFill, backgroundColor: colors.dangerTint },
});
