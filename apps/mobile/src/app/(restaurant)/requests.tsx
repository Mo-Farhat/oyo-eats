import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, IconButton, Screen, Text } from '@/components';
import { MENU, MENU_REQUESTS } from '@/restaurant/queries';
import { RequestCard } from '@/restaurant/RequestCard';

/** T09: change requests, pending first, with Oyo Eats' notes (RES-09). */
export default function Requests() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: MENU_REQUESTS,
    queryFn: restaurantApi.requests,
    refetchInterval: 30_000,
  });
  const withdraw = useMutation({
    mutationFn: restaurantApi.withdraw,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MENU_REQUESTS });
      void queryClient.invalidateQueries({ queryKey: MENU });
    },
  });
  const all = list.data ?? [];
  const pending = all.filter((r) => r.status === 'pending');
  const reviewed = all.filter((r) => r.status !== 'pending');
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Change Requests
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {list.error || withdraw.error ? (
        <Alert tone="danger" message={errorMessage(list.error ?? withdraw.error)} />
      ) : null}
      {pending.length ? (
        <Alert tone="green" message="Oyo Eats usually reviews changes within a few hours." />
      ) : null}
      {pending.length ? <Text variant="label">Pending</Text> : null}
      {pending.map((r) => (
        <RequestCard key={r.id} r={r}>
          <Button
            small
            variant="ghost"
            label="Withdraw"
            loading={withdraw.isPending && withdraw.variables === r.id}
            onPress={() => withdraw.mutate(r.id)}
          />
        </RequestCard>
      ))}
      {reviewed.length ? <Text variant="label">Reviewed</Text> : null}
      {reviewed.map((r) => (
        <RequestCard key={r.id} r={r}>
          {r.status === 'rejected' && r.menuItemId && r.kind === 'edit' ? (
            <Button
              small
              variant="secondary"
              label="Edit & Resubmit"
              onPress={() => router.push(`/dish/${r.menuItemId}`)}
            />
          ) : null}
        </RequestCard>
      ))}
      {list.data && all.length === 0 ? (
        <Text variant="muted">No changes sent yet. Edit an item from the Menu tab.</Text>
      ) : null}
    </Screen>
  );
}
