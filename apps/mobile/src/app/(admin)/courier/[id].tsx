import { can, formatLkr, type CreatedAccount } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { adminApi, dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { ADMIN_ACCOUNTS, ADMIN_RIDERS, adminRiderKey } from '@/admin/queries';
import { initials, riderChip, seenAgo } from '@/admin/riderStatus';
import { TemporaryPassword } from '@/admin/TemporaryPassword';
import { useSession } from '@/auth/session';
import { call, localPhone } from '@/call';
import { Alert, Button, Card, Chip, ConfirmSheet, IconButton, Screen, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text variant="small">{label}</Text>
    </View>
  );
}

/** A09: one rider: contact, today's work, cash on hand and handovers, low ratings, actions. */
export default function RiderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'cash.write_off');
  const queryClient = useQueryClient();
  const rider = useQuery({
    queryKey: adminRiderKey(id),
    queryFn: () => dispatchApi.rider(id),
    refetchInterval: 15_000,
  });
  const [issued, setIssued] = useState<CreatedAccount | null>(null);
  const [confirm, setConfirm] = useState<'offline' | 'suspend' | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: adminRiderKey(id) });
    void queryClient.invalidateQueries({ queryKey: ADMIN_RIDERS });
    void queryClient.invalidateQueries({ queryKey: ADMIN_ACCOUNTS });
  };
  const reset = useMutation({ mutationFn: () => adminApi.resetPassword(id), onSuccess: setIssued });
  const offline = useMutation({
    mutationFn: () => dispatchApi.forceOffline(id),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });
  const active = useMutation({
    mutationFn: (on: boolean) => adminApi.setActive(id, on),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });
  const sign = useMutation({
    mutationFn: dispatchApi.countersign,
    onSuccess: (d) => queryClient.setQueryData(adminRiderKey(id), d),
  });

  const r = rider.data;
  const chip = r ? riderChip(r) : null;
  const busy = (r?.activeJobs ?? 0) > 0;
  const error = rider.error ?? reset.error ?? offline.error ?? active.error ?? sign.error;

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/riders'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Rider
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
      {issued ? (
        <TemporaryPassword
          created={issued}
          title="New one-time password"
          onDone={() => setIssued(null)}
        />
      ) : null}
      {r && chip ? (
        <>
          <Card style={styles.head}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(r.name)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="h3">{r.name}</Text>
              <Text variant="small">
                {[r.username, r.phone ? localPhone(r.phone) : null].filter(Boolean).join(' · ')}
              </Text>
              <Text variant="small">
                {[r.vehicle, r.plate, r.nicOnFile ? 'NIC on file' : 'No NIC'].join(' · ')}
              </Text>
              <Text variant="small">{seenAgo(r.lastSeenAt)}</Text>
            </View>
            <Chip label={chip.label} tone={chip.tone} />
          </Card>
          {r.phone ? (
            <Button
              variant="secondary"
              label={`Call ${r.name.split(' ')[0]}`}
              onPress={() => call(r.phone!)}
            />
          ) : null}

          <View style={styles.stats}>
            <Stat
              value={r.rating ? r.rating.toFixed(1) : '—'}
              label={`Rating (${r.ratingCount})`}
            />
            <Stat value={String(r.deliveredToday)} label="Delivered today" />
            <Stat value={String(r.declinedThisWeek)} label="Declined, 7 days" />
          </View>

          {r.jobs.length ? (
            <Card style={{ gap: 6 }}>
              <Text variant="strong">On a job</Text>
              {r.jobs.map((j) => (
                <Button
                  key={j.orderId}
                  small
                  variant="ghost"
                  label={`#${j.reference} · ${j.status === 'picked_up' ? 'on the way' : 'to restaurant'}`}
                  onPress={() => router.push(`/ticket/${j.orderId}`)}
                />
              ))}
            </Card>
          ) : null}

          <Card tone={r.cashHeldCents >= r.cashCapCents ? 'warn' : 'default'} style={{ gap: 6 }}>
            <View style={styles.between}>
              <Text variant="strong">Cash on hand</Text>
              <Text variant="strong">{formatLkr(r.cashHeldCents)}</Text>
            </View>
            <Text variant="small">
              {[
                `${r.cashOrders.length} COD ${r.cashOrders.length === 1 ? 'order' : 'orders'} since the last handover`,
                r.handovers[0]
                  ? `last handover ${when(r.handovers[0].recordedAt)}`
                  : 'no handovers yet',
                r.cashHeldCents >= r.cashCapCents
                  ? `at the ${formatLkr(r.cashCapCents)} cap: no COD offers until handed over`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Button
              variant="secondary"
              small
              label="Record Handover"
              disabled={r.cashHeldCents <= 0}
              onPress={() => router.push(`/handover/${r.id}`)}
              style={{ alignSelf: 'stretch' }}
            />
          </Card>

          {r.handovers.length ? (
            <Card style={{ gap: 8 }}>
              <Text variant="strong">Handovers</Text>
              {r.handovers.map((h) => {
                const diff = h.amountCents - h.expectedCents;
                return (
                  <View key={h.id} style={styles.handover}>
                    <View style={styles.between}>
                      <Text variant="body">{`${when(h.recordedAt)} · ${h.recordedBy}`}</Text>
                      <Text variant="strong">{formatLkr(h.amountCents)}</Text>
                    </View>
                    {diff ? (
                      <>
                        <Text
                          variant="small"
                          style={{ color: diff < 0 ? colors.danger : colors.warn }}
                        >
                          {`${diff < 0 ? 'Short' : 'Over'} by ${formatLkr(Math.abs(diff))}: ${h.varianceReason ?? ''}`}
                        </Text>
                        {h.countersignedBy ? (
                          <Text variant="small">{`Signed off by ${h.countersignedBy}`}</Text>
                        ) : owner ? (
                          <Button
                            small
                            variant="ghost"
                            label="Sign Off Difference"
                            loading={sign.isPending && sign.variables === h.id}
                            onPress={() => sign.mutate(h.id)}
                          />
                        ) : (
                          <Text variant="small">Waiting for the owner to sign off</Text>
                        )}
                      </>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          ) : null}

          {r.lowRatings.map((l, i) => (
            <Alert
              key={i}
              tone="danger"
              message={`${l.rating}★ ${when(l.at)}${l.tags.length ? ` · ${l.tags.join(', ')}` : ''}${l.body ? `: “${l.body}”` : ''}`}
            />
          ))}

          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <Button
                small
                variant="secondary"
                label="Reset Password"
                loading={reset.isPending}
                onPress={() => reset.mutate()}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                small
                variant="secondary"
                label="Force Offline"
                disabled={busy || r.status === 'offline' || r.status === 'suspended'}
                onPress={() => setConfirm('offline')}
              />
            </View>
          </View>
          {r.status === 'suspended' ? (
            <Button
              variant="secondary"
              label="Reactivate Rider"
              loading={active.isPending}
              onPress={() => active.mutate(true)}
            />
          ) : (
            <Button
              variant="danger"
              label="Suspend Rider"
              disabled={busy}
              onPress={() => setConfirm('suspend')}
            />
          )}
          {busy ? (
            <Text variant="small">
              Force offline and suspend unlock once the current job is done or reassigned.
            </Text>
          ) : null}
        </>
      ) : null}

      <ConfirmSheet
        visible={!!confirm}
        title={
          confirm === 'offline' ? `Take ${r?.name ?? ''} offline?` : `Suspend ${r?.name ?? ''}?`
        }
        message={
          confirm === 'offline'
            ? 'They stop getting offers until they go online again.'
            : 'They’re signed out everywhere and can’t sign in until reactivated. Cash they hold stays on their balance.'
        }
        confirmLabel={confirm === 'offline' ? 'Take Offline' : 'Suspend'}
        danger
        loading={offline.isPending || active.isPending}
        onConfirm={() => (confirm === 'offline' ? offline.mutate() : active.mutate(false))}
        onCancel={() => setConfirm(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 9999,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display700, fontSize: 20, color: colors.strong },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 2,
  },
  statValue: { fontFamily: fonts.display700, fontSize: 18, color: colors.strong },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  handover: { gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { flexDirection: 'row', gap: 8 },
});
