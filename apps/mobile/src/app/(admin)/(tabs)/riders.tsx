import { formatLkr, type AdminRiderSummary } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { ADMIN_RIDERS } from '@/admin/queries';
import { initials, riderChip, seenAgo } from '@/admin/riderStatus';
import { Alert, Chip, IconButton, Screen, Segmented, Text, TextField } from '@/components';
import { colors, fonts } from '@/theme/tokens';

type Filter = 'online' | 'offline' | 'suspended';

function line(r: AdminRiderSummary) {
  const parts: string[] = [];
  if (r.noSignal) parts.push(`No location · ${seenAgo(r.lastSeenAt)}`);
  else if (r.status === 'on_job') parts.push(`${r.activeJobs} active`);
  else if (r.status === 'offline') parts.push(seenAgo(r.lastSeenAt));
  if (r.cashHeldCents) parts.push(`cash ${formatLkr(r.cashHeldCents)}`);
  parts.push(`${r.deliveredToday} today`);
  if (r.declinedToday) parts.push(`declined ${r.declinedToday}`);
  return parts.join(' · ');
}

function Row({ r }: { r: AdminRiderSummary }) {
  const chip = riderChip(r);
  const nearCap = r.cashHeldCents >= r.cashCapCents * 0.8;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${chip.label}`}
      onPress={() => router.push(`/courier/${r.id}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(r.name)}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="strong">{r.name}</Text>
        <Text
          variant="small"
          numberOfLines={1}
          style={
            r.noSignal ? { color: colors.danger } : nearCap ? { color: colors.warn } : undefined
          }
        >
          {line(r)}
        </Text>
      </View>
      <Chip label={chip.label} tone={chip.tone} />
    </Pressable>
  );
}

/** A08: riders by status with search (ADM-07). Refreshes every 10 s. */
export default function Riders() {
  const riders = useQuery({
    queryKey: ADMIN_RIDERS,
    queryFn: dispatchApi.riders,
    refetchInterval: 10_000,
  });
  const [filter, setFilter] = useState<Filter>('online');
  const [q, setQ] = useState('');
  const all = riders.data ?? [];
  const bucket = (r: AdminRiderSummary): Filter =>
    r.status === 'suspended' ? 'suspended' : r.status === 'offline' ? 'offline' : 'online';
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((r) => bucket(r) === filter)
    .filter(
      (r) =>
        !needle ||
        r.name.toLowerCase().includes(needle) ||
        r.plate.toLowerCase().includes(needle) ||
        (r.username ?? '').includes(needle),
    )
    // Trouble first: no signal, then at cap, then on a job.
    .sort(
      (a, b) =>
        Number(b.noSignal) - Number(a.noSignal) ||
        Number(b.cashHeldCents >= b.cashCapCents) - Number(a.cashHeldCents >= a.cashCapCents) ||
        b.activeJobs - a.activeJobs ||
        a.name.localeCompare(b.name),
    );
  const count = (f: Filter) => all.filter((r) => bucket(r) === f).length;

  return (
    <Screen inTabs bodyStyle={{ gap: 12, paddingTop: 24 }}>
      <View style={styles.between}>
        <Text variant="h1" accessibilityRole="header">
          Riders
        </Text>
        <IconButton
          icon="plus"
          green
          label="Add rider"
          onPress={() => router.push({ pathname: '/account-new', params: { role: 'rider' } })}
        />
      </View>
      {riders.error ? <Alert tone="danger" message={errorMessage(riders.error)} /> : null}
      <TextField
        label="Search"
        placeholder="Name or plate"
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      <Segmented
        options={[
          { value: 'online', label: `Online ${count('online')}` },
          { value: 'offline', label: `Offline ${count('offline')}` },
          { value: 'suspended', label: `Suspended ${count('suspended')}` },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {riders.data && rows.length === 0 ? (
        <Text variant="muted">{needle ? 'No rider matches.' : 'No riders here.'}</Text>
      ) : null}
      <View>
        {rows.map((r) => (
          <Row key={r.id} r={r} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.sans700, fontSize: 14, color: colors.strong },
});
