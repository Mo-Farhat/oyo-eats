import { formatLkr } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Chip, Icon, MapPlaceholder, Text } from '@/components';
import { RIDER_STATE, useRiderState } from '@/rider/queries';
import { colors } from '@/theme/tokens';

/** R01 / R02: offline or waiting for a job; the current job if there is one. */
export default function RiderHome() {
  const queryClient = useQueryClient();
  const state = useRiderState();
  const s = state.data;
  const [locError, setLocError] = useState<string>();
  const toggle = useMutation({
    mutationFn: async (online: boolean) => {
      if (online) {
        // Location is asked for in context, with the reason (PRI-03); it's needed to get jobs.
        const p = await Location.requestForegroundPermissionsAsync();
        if (!p.granted) {
          setLocError(
            'Location is needed while you are online so dispatch can offer you nearby jobs.',
          );
          return;
        }
      }
      setLocError(undefined);
      await riderApi.setOnline(online);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: RIDER_STATE }),
  });
  const job = s?.jobs[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <MapPlaceholder height={900} pin="scooter">
          <SafeAreaView edges={['top']} style={styles.overlay}>
            <Chip tone={s?.online ? 'on' : 'neutral'} label={s?.online ? '● Online' : 'Offline'} />
            <Pressable accessibilityRole="button" onPress={() => router.navigate('/cash')}>
              <Chip label={`Cash ${formatLkr(s?.cashHeldCents ?? 0)}`} />
            </Pressable>
          </SafeAreaView>
        </MapPlaceholder>
      </View>
      <Card style={styles.sheet}>
        {state.error ? <Alert tone="danger" message={errorMessage(state.error)} /> : null}
        {job ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/job/${job.orderId}`)}
            style={styles.row}
          >
            <View style={styles.tile}>
              <Icon name="scooter" color="#ffffff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="h3">
                {job.status === 'picked_up' ? 'Delivering' : 'Go to the restaurant'}
              </Text>
              <Text variant="small">{`#${job.reference} · ${job.status === 'picked_up' ? job.customer.firstName : job.restaurant.name}`}</Text>
            </View>
            <Icon name="chevron" />
          </Pressable>
        ) : (
          <View style={styles.row}>
            <View style={styles.tile}>
              <Icon name={s?.online ? 'bell' : 'scooter'} color="#ffffff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="h3">{s?.online ? 'Waiting for a Job' : "You're Offline"}</Text>
              <Text variant="small">
                {s?.online
                  ? 'Dispatch will ring your phone. Stay near town centre.'
                  : 'Go online to start getting jobs.'}
              </Text>
            </View>
          </View>
        )}
        {s && s.consecutiveMisses >= 3 && !s.online ? (
          <Alert message="You missed 3 offers in a row, so you were set offline. Go online when you're ready." />
        ) : null}
        {locError || toggle.error ? (
          <Alert tone="danger" message={locError ?? errorMessage(toggle.error)} />
        ) : null}
        {s?.online ? (
          <Button
            variant="secondary"
            label="Go Offline"
            disabled={!!job}
            loading={toggle.isPending}
            onPress={() => toggle.mutate(false)}
          />
        ) : (
          <Button
            label="Go Online"
            loading={toggle.isPending}
            onPress={() => toggle.mutate(true)}
          />
        )}
        {s?.online && job ? (
          <Text variant="small">Go Offline is disabled while you hold a job.</Text>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    paddingTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheet: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: 0,
    padding: 20,
    gap: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
