import { formatLkr, type AdminRestaurantDetail, type CreatedAccount } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { adminApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { HoursEditor } from '@/admin/HoursEditor';
import { MenuItemForm } from '@/admin/MenuItemForm';
import { ADMIN_RESTAURANTS, adminRestaurantKey, useAdminRestaurant } from '@/admin/queries';
import { RestaurantForm } from '@/admin/RestaurantForm';
import { TemporaryPassword } from '@/admin/TemporaryPassword';
import {
  Alert,
  Button,
  Card,
  Chip,
  ConfirmSheet,
  IconButton,
  Screen,
  Sheet,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { colors } from '@/theme/tokens';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = {
  active: { label: 'Live', tone: 'green' },
  onboarding: { label: 'Setting up', tone: 'warn' },
  suspended: { label: 'Suspended', tone: 'danger' },
} as const;
const ROLE = { restaurant_owner: 'Owner', restaurant_staff: 'Kitchen staff' } as Record<
  string,
  string
>;

function hoursLine(weekly: AdminRestaurantDetail['weekly']) {
  if (!weekly.length) return 'No hours set';
  return DAY.map((d, i) => {
    const ranges = weekly.filter((w) => w.weekday === i);
    if (!ranges.length) return `${d} closed`;
    return `${d} ${ranges.map((r) => (r.opensAt === r.closesAt ? 'all day' : `${r.opensAt}–${r.closesAt}`)).join(', ')}`;
  }).join('\n');
}

type Panel = 'profile' | 'hours' | 'item' | null;

/** A14: one restaurant's setup and status: profile, hours, menu, logins, go live (ADM-11, ADM-12). */
export default function RestaurantSetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const detail = useAdminRestaurant(id);
  const r = detail.data;
  const [panel, setPanel] = useState<Panel>(null);
  const [category, setCategory] = useState('');
  const [issued, setIssued] = useState<CreatedAccount | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  const fresh = (next?: AdminRestaurantDetail) => {
    if (next) queryClient.setQueryData(adminRestaurantKey(id), next);
    else void queryClient.invalidateQueries({ queryKey: adminRestaurantKey(id) });
    void queryClient.invalidateQueries({ queryKey: ADMIN_RESTAURANTS });
  };
  const close = (next: AdminRestaurantDetail) => {
    fresh(next);
    setPanel(null);
  };
  const update = useMutation({
    mutationFn: (input: Parameters<typeof adminApi.updateRestaurant>[1]) =>
      adminApi.updateRestaurant(id, input),
    onSuccess: close,
  });
  const hours = useMutation({
    mutationFn: (input: Parameters<typeof adminApi.setHours>[1]) => adminApi.setHours(id, input),
    onSuccess: close,
  });
  const status = useMutation({
    mutationFn: (s: AdminRestaurantDetail['status']) => adminApi.setRestaurantStatus(id, s),
    onSuccess: (next) => {
      fresh(next);
      setConfirmSuspend(false);
    },
  });
  const addCategory = useMutation({
    mutationFn: () => adminApi.addCategory(id, category.trim(), r?.menu.length ?? 0),
    onSuccess: () => {
      setCategory('');
      fresh();
    },
  });
  const addItem = useMutation({
    mutationFn: (input: Parameters<typeof adminApi.addItem>[1]) => adminApi.addItem(id, input),
    onSuccess: () => {
      fresh();
      setPanel(null);
    },
  });
  const editItem = useMutation({
    mutationFn: (v: { itemId: string; soldOut?: boolean; archived?: boolean }) =>
      adminApi.updateItem(id, v.itemId, { soldOut: v.soldOut, archived: v.archived }),
    onSuccess: () => fresh(),
  });
  const reset = useMutation({
    mutationFn: adminApi.resetPassword,
    onSuccess: setIssued,
  });
  const error =
    status.error ?? addCategory.error ?? editItem.error ?? reset.error ?? detail.error ?? null;

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/restaurants'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header" numberOfLines={1}>
              {r?.name ?? 'Restaurant'}
            </Text>
            {r ? <Text variant="small">{r.addressText}</Text> : null}
          </View>
          {r ? <Chip label={STATUS[r.status].label} tone={STATUS[r.status].tone} /> : null}
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
      {issued ? (
        <TemporaryPassword
          created={issued}
          title="New one-time password"
          onDone={() => setIssued(null)}
        />
      ) : null}

      {r ? (
        <>
          {/* Status and what blocks going live */}
          {r.status === 'active' ? (
            <Card tone="green">
              <Text variant="strong">{r.isOpen ? 'Live and open now' : 'Live, closed now'}</Text>
              <Text variant="muted">{`${r.ordersToday} orders today.`}</Text>
              <Button
                variant="secondary"
                label="Suspend Restaurant"
                onPress={() => setConfirmSuspend(true)}
              />
            </Card>
          ) : (
            <Card tone={r.goLiveBlockers.length ? 'warn' : 'green'}>
              <Text variant="strong">
                {r.status === 'suspended' ? 'Suspended: hidden from customers' : 'Not live yet'}
              </Text>
              {r.goLiveBlockers.length ? (
                r.goLiveBlockers.map((b) => <Text key={b} variant="muted">{`•  ${b}`}</Text>)
              ) : (
                <Text variant="muted">Everything is in place.</Text>
              )}
              <Button
                label="Go Live"
                disabled={r.goLiveBlockers.length > 0}
                loading={status.isPending}
                onPress={() => status.mutate('active')}
              />
            </Card>
          )}

          {/* Profile */}
          <Card>
            <View style={styles.between}>
              <Text variant="h3">Details</Text>
              <Button small variant="ghost" label="Edit" onPress={() => setPanel('profile')} />
            </View>
            <Text variant="muted">
              {[
                r.cuisines.join(', ') || 'No cuisines',
                `${r.prepMinutes} min prep`,
                `Pin ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`,
              ].join(' · ')}
            </Text>
            <Text variant="muted">
              {r.licenceNumber
                ? `Licence ${r.licenceNumber}, expires ${r.licenceExpiresOn ?? '?'}`
                : 'No licence on file'}
            </Text>
            <Text variant="muted">
              {r.bankDetails
                ? `Payouts to ${r.bankDetails.bankName} ${r.bankDetails.branch}, ${r.bankDetails.accountName}, ****${r.bankDetails.accountNumber.slice(-4)}`
                : 'No payout bank account'}
            </Text>
          </Card>

          {/* Hours */}
          <Card>
            <View style={styles.between}>
              <Text variant="h3">Opening hours</Text>
              <Button small variant="ghost" label="Edit" onPress={() => setPanel('hours')} />
            </View>
            <Text variant="muted">{hoursLine(r.weekly)}</Text>
          </Card>

          {/* Menu */}
          <Card>
            <View style={styles.between}>
              <Text variant="h3">Menu</Text>
              {r.menu.length ? (
                <Button small variant="ghost" label="Add Item" onPress={() => setPanel('item')} />
              ) : null}
            </View>
            {r.menu.map((c) => (
              <View key={c.id} style={{ gap: 8 }}>
                <Text variant="label">{c.name}</Text>
                {c.items.length === 0 ? <Text variant="small">No items yet</Text> : null}
                {c.items.map((i) => (
                  <View key={i.id} style={[styles.item, i.archived && { opacity: 0.5 }]}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="strong">{i.name}</Text>
                      <Text variant="small">
                        {[
                          formatLkr(i.priceCents),
                          ...i.groups.map(
                            (g) => `${g.name}: ${g.options.map((o) => o.name).join(' / ')}`,
                          ),
                          i.archived ? 'Removed' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    {i.archived ? (
                      <Button
                        small
                        variant="ghost"
                        label="Restore"
                        onPress={() => editItem.mutate({ itemId: i.id, archived: false })}
                      />
                    ) : (
                      <>
                        <View style={{ alignItems: 'center', gap: 2 }}>
                          <Toggle
                            label={`${i.name} available`}
                            value={!i.soldOut}
                            onChange={(on) => editItem.mutate({ itemId: i.id, soldOut: !on })}
                          />
                          <Text variant="small">{i.soldOut ? 'Sold out' : 'Available'}</Text>
                        </View>
                        <IconButton
                          icon="close"
                          label={`Remove ${i.name}`}
                          onPress={() => editItem.mutate({ itemId: i.id, archived: true })}
                        />
                      </>
                    )}
                  </View>
                ))}
              </View>
            ))}
            <View style={styles.addRow}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="New category"
                  hint="e.g. Kottu, Rice & Curry, Drinks"
                  value={category}
                  onChangeText={setCategory}
                />
              </View>
            </View>
            <Button
              variant="secondary"
              label="Add Category"
              disabled={!category.trim()}
              loading={addCategory.isPending}
              onPress={() => addCategory.mutate()}
            />
          </Card>

          {/* Logins */}
          <Card>
            <View style={styles.between}>
              <Text variant="h3">Logins</Text>
              <Button
                small
                variant="ghost"
                label="Add Login"
                onPress={() =>
                  router.push({
                    pathname: '/account-new',
                    params: { role: 'restaurant_owner', tenantId: id, place: r.name },
                  })
                }
              />
            </View>
            {r.users.length === 0 ? (
              <Text variant="muted">
                No logins yet. Create one for the owner; they sign in on the kitchen tablet.
              </Text>
            ) : null}
            {r.users.map((u) => (
              <View key={u.id} style={styles.item}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="strong">{u.displayName}</Text>
                  <Text variant="small">
                    {[ROLE[u.role] ?? u.role, u.username, u.active ? null : 'Switched off']
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Button
                  small
                  variant="secondary"
                  label="Reset"
                  loading={reset.isPending && reset.variables === u.id}
                  onPress={() => reset.mutate(u.id)}
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Sheet visible={panel === 'profile'} onClose={() => setPanel(null)} tall>
        <Text variant="h2">Edit Details</Text>
        {update.error ? <Alert tone="danger" message={errorMessage(update.error)} /> : null}
        {r ? (
          <RestaurantForm
            initial={r}
            submitLabel="Save"
            busy={update.isPending}
            onSubmit={(input) => update.mutate(input)}
          />
        ) : null}
      </Sheet>
      <Sheet visible={panel === 'hours'} onClose={() => setPanel(null)} tall>
        {hours.error ? <Alert tone="danger" message={errorMessage(hours.error)} /> : null}
        {r ? (
          <HoursEditor
            weekly={r.weekly}
            busy={hours.isPending}
            onSave={(input) => hours.mutate(input)}
          />
        ) : null}
      </Sheet>
      <Sheet visible={panel === 'item'} onClose={() => setPanel(null)} tall>
        {addItem.error ? <Alert tone="danger" message={errorMessage(addItem.error)} /> : null}
        {r ? (
          <MenuItemForm
            categories={r.menu}
            busy={addItem.isPending}
            onSubmit={(input) => addItem.mutate(input)}
          />
        ) : null}
      </Sheet>
      <ConfirmSheet
        visible={confirmSuspend}
        title="Suspend this restaurant?"
        message="It disappears from the app at once. Orders already placed carry on."
        confirmLabel="Suspend"
        danger
        loading={status.isPending}
        onConfirm={() => status.mutate('suspended')}
        onCancel={() => setConfirmSuspend(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
});
