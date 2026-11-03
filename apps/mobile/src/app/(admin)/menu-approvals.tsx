import type { MenuChangeRequest } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, IconButton, Screen, Sheet, Text, TextField } from '@/components';
import { MENU_APPROVALS } from '@/admin/queries';
import { RequestCard } from '@/restaurant/RequestCard';

/** A15: restaurant menu changes waiting for the owner, before and after (ADM-12). */
export default function MenuApprovals() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: MENU_APPROVALS,
    queryFn: dispatchApi.menuRequests,
    refetchInterval: 30_000,
  });
  const [rejecting, setRejecting] = useState<MenuChangeRequest | null>(null);
  const [note, setNote] = useState('');
  const review = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note?: string }) =>
      dispatchApi.reviewMenuRequest(v.id, v.approve, v.note),
    onSuccess: () => {
      setRejecting(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: MENU_APPROVALS });
    },
  });
  const pending = list.data?.pending ?? [];
  const recent = list.data?.recent ?? [];
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Menu Approvals
            </Text>
            <Text variant="small">{`${pending.length} waiting`}</Text>
          </View>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {list.error || review.error ? (
        <Alert tone="danger" message={errorMessage(list.error ?? review.error)} />
      ) : null}
      {list.data && pending.length === 0 ? (
        <Text variant="muted">Nothing waiting. Approved changes go live straight away.</Text>
      ) : null}
      {pending.map((r) => (
        <RequestCard key={r.id} r={r} showRestaurant>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                small
                variant="secondary"
                label="Reject"
                onPress={() => setRejecting(r)}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                small
                label="Approve"
                loading={
                  review.isPending && review.variables?.id === r.id && review.variables.approve
                }
                onPress={() => review.mutate({ id: r.id, approve: true })}
                style={{ alignSelf: 'stretch' }}
              />
            </View>
          </View>
        </RequestCard>
      ))}
      {recent.length ? <Text variant="label">Recently decided</Text> : null}
      {recent.map((r) => (
        <RequestCard key={r.id} r={r} showRestaurant />
      ))}

      <Sheet
        visible={!!rejecting}
        onClose={() => setRejecting(null)}
        footer={
          <Button
            variant="danger"
            label="Reject Change"
            disabled={note.trim().length < 3}
            loading={review.isPending}
            onPress={() =>
              rejecting && review.mutate({ id: rejecting.id, approve: false, note: note.trim() })
            }
          />
        }
      >
        <Text variant="h2">{`Reject ${rejecting?.itemName ?? ''}?`}</Text>
        <Text variant="muted">
          The restaurant sees your note and can change it and send it again.
        </Text>
        <TextField label="Note to the restaurant" value={note} onChangeText={setNote} multiline />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
});
