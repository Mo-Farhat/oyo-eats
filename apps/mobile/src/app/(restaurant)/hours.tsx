import type { RestaurantHours } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { HoursEditor } from '@/admin/HoursEditor';
import {
  Alert,
  Button,
  Card,
  Chip,
  IconButton,
  Screen,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { BOARD, HOURS } from '@/restaurant/queries';
import { colors } from '@/theme/tokens';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

/** Paused until far in the future means "until reopened". */
const untilReopened = (iso: string) => new Date(iso).getUTCFullYear() >= 2100;

/** T10: pause, weekly hours and special closures (RES-10). Everything here is instant. */
export default function Hours() {
  const queryClient = useQueryClient();
  const hours = useQuery({
    queryKey: HOURS,
    queryFn: restaurantApi.hours,
    refetchInterval: 60_000,
  });
  const done = (h?: RestaurantHours) => {
    if (h) queryClient.setQueryData(HOURS, h);
    else void queryClient.invalidateQueries({ queryKey: HOURS });
    void queryClient.invalidateQueries({ queryKey: BOARD });
  };
  const pause = useMutation({
    mutationFn: (v: { open: boolean; minutes?: 15 | 30 | 60 }) =>
      restaurantApi.setOpen(v.open, v.minutes),
    onSuccess: () => done(),
  });
  const save = useMutation({ mutationFn: restaurantApi.setHours, onSuccess: done });
  const [date, setDate] = useState('');
  const [closed, setClosed] = useState(true);
  const [opensAt, setOpensAt] = useState('10:00');
  const [closesAt, setClosesAt] = useState('15:00');
  const [problem, setProblem] = useState<string>();
  const addClosure = useMutation({
    mutationFn: () =>
      restaurantApi.addClosure(
        closed ? { date, closed: true } : { date, closed: false, opensAt, closesAt },
      ),
    onSuccess: (h) => {
      setDate('');
      done(h);
    },
  });
  const removeClosure = useMutation({ mutationFn: restaurantApi.removeClosure, onSuccess: done });
  const h = hours.data;
  const error = hours.error ?? pause.error ?? save.error ?? addClosure.error ?? removeClosure.error;

  const submitClosure = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()))
      return setProblem('Enter the date as YYYY-MM-DD.');
    if (!closed && !(HHMM.test(opensAt) && HHMM.test(closesAt)))
      return setProblem('Use 24-hour times like 10:00 and 15:00.');
    setProblem(undefined);
    addClosure.mutate();
  };

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
            Store Hours
          </Text>
          {h ? (
            <Chip
              label={h.isOpen ? 'Open now' : 'Closed now'}
              tone={h.isOpen ? 'green' : 'neutral'}
            />
          ) : null}
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
      {h ? (
        <>
          <Card tone={h.pausedUntil ? 'warn' : 'default'} style={{ gap: 8 }}>
            <Text variant="strong">
              {h.pausedUntil
                ? untilReopened(h.pausedUntil)
                  ? 'Paused until you reopen'
                  : `Paused until ${time(h.pausedUntil)}`
                : 'Taking orders'}
            </Text>
            <Text variant="small">
              Pausing stops new orders. Orders already in progress carry on as normal.
            </Text>
            {h.pausedUntil ? (
              <Button
                label="Reopen Now"
                loading={pause.isPending}
                onPress={() => pause.mutate({ open: true })}
              />
            ) : (
              <View style={styles.row}>
                {([15, 30, 60] as const).map((m) => (
                  <View key={m} style={{ flex: 1 }}>
                    <Button
                      small
                      variant="secondary"
                      label={`${m} min`}
                      onPress={() => pause.mutate({ open: false, minutes: m })}
                      style={{ alignSelf: 'stretch' }}
                    />
                  </View>
                ))}
              </View>
            )}
            {!h.pausedUntil ? (
              <Button
                small
                variant="ghost"
                label="Pause Until I Reopen"
                onPress={() => pause.mutate({ open: false })}
              />
            ) : null}
          </Card>

          <Card>
            <HoursEditor
              key={JSON.stringify(h.weekly)}
              weekly={h.weekly}
              busy={save.isPending}
              onSave={(input) => save.mutate(input)}
            />
          </Card>

          <Card style={{ gap: 8 }}>
            <Text variant="h3">Special closures</Text>
            <Text variant="small">
              Holidays and Poya days. Customers can’t order outside these.
            </Text>
            {h.closures.map((c) => (
              <View key={c.id} style={styles.closure}>
                <Text variant="body" style={{ flex: 1 }}>
                  {dayLabel(c.date)}
                </Text>
                <Chip label={c.closed ? 'Closed all day' : `${c.opensAt}–${c.closesAt}`} />
                <IconButton
                  icon="close"
                  label={`Remove ${dayLabel(c.date)}`}
                  onPress={() => removeClosure.mutate(c.id)}
                />
              </View>
            ))}
            <TextField
              label="Date"
              placeholder="YYYY-MM-DD"
              value={date}
              onChangeText={setDate}
              autoCapitalize="none"
            />
            <View style={styles.row}>
              <Text variant="body" style={{ flex: 1 }}>
                Closed all day
              </Text>
              <Toggle label="Closed all day" value={closed} onChange={setClosed} />
            </View>
            {!closed ? (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <TextField label="Opens" value={opensAt} onChangeText={setOpensAt} />
                </View>
                <View style={{ flex: 1 }}>
                  <TextField label="Closes" value={closesAt} onChangeText={setClosesAt} />
                </View>
              </View>
            ) : null}
            {problem ? <Alert tone="danger" message={problem} /> : null}
            <Button
              variant="secondary"
              label="Add Closure"
              disabled={!date.trim()}
              loading={addClosure.isPending}
              onPress={submitClosure}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
