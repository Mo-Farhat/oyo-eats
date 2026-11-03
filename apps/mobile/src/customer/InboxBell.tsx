import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from '@/components';
import { useNotifications } from '@/notifications/queries';
import { colors, fonts } from '@/theme/tokens';

/** Bell with the unread count; opens the notification list (NOT-06). */
export function InboxBell() {
  const unread = useNotifications().data?.unread ?? 0;
  return (
    <View>
      <IconButton
        icon="bell"
        label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onPress={() => router.push('/inbox')}
      />
      {unread ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 9999,
    backgroundColor: colors.dangerFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#ffffff', fontFamily: fonts.sans700, fontSize: 11 },
});
