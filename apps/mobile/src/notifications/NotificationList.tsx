import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, IconButton, Screen, Text } from '@/components';
import { NOTIFICATIONS, useNotifications } from './queries';
import { colors } from '@/theme/tokens';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

/** NOT-06: the last 30 days of notifications; opening the list marks them read. */
export function NotificationList({ open, home }: { open: (orderId: string) => Href; home: Href }) {
  const list = useNotifications();
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationFn: authApi.markNotificationsRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS }),
  });
  const unread = list.data?.unread ?? 0;
  useEffect(() => {
    if (unread) read.mutate();
  }, [unread]);
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace(home))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Notifications
          </Text>
        </>
      }
      bodyStyle={{ gap: 0 }}
    >
      {list.error ? <Alert tone="danger" message={errorMessage(list.error)} /> : null}
      {list.data && list.data.items.length === 0 ? (
        <Text variant="muted">Updates will show up here.</Text>
      ) : null}
      {list.data?.items.map((n) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          disabled={!n.data.orderId}
          onPress={() => n.data.orderId && router.push(open(n.data.orderId))}
          style={styles.row}
        >
          {!n.read ? <View style={styles.dot} /> : <View style={styles.spacer} />}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="strong">{n.title}</Text>
            <Text variant="body">{n.body}</Text>
            <Text variant="small">{when(n.createdAt)}</Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: { width: 8, height: 8, borderRadius: 9999, backgroundColor: colors.brand, marginTop: 6 },
  spacer: { width: 8 },
});
