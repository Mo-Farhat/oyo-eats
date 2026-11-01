import type { HoursInput } from '@oyo/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Alert, Button, Text, TextField, Toggle } from '@/components';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
type Day = { open: boolean; opensAt: string; closesAt: string };

/**
 * Weekly hours, one range per day (Asia/Colombo). A closing time before the opening time runs
 * past midnight; the same time for both means open all day. Split shifts come with T10.
 */
export function HoursEditor({
  weekly,
  busy,
  onSave,
}: {
  weekly: HoursInput['weekly'];
  busy: boolean;
  onSave: (input: HoursInput) => void;
}) {
  const [days, setDays] = useState<Day[]>(() =>
    DAYS.map((_, weekday) => {
      const h = weekly.find((w) => w.weekday === weekday);
      return h
        ? { open: true, opensAt: h.opensAt, closesAt: h.closesAt }
        : { open: false, opensAt: '10:00', closesAt: '22:00' };
    }),
  );
  const [problem, setProblem] = useState<string>();
  const set = (i: number, patch: Partial<Day>) =>
    setDays(days.map((d, n) => (n === i ? { ...d, ...patch } : d)));

  const save = () => {
    const bad = days.findIndex((d) => d.open && !(HHMM.test(d.opensAt) && HHMM.test(d.closesAt)));
    if (bad >= 0) return setProblem(`${DAYS[bad]}: use 24-hour times like 09:30 and 22:00.`);
    setProblem(undefined);
    onSave({
      weekly: days.flatMap((d, weekday) =>
        d.open ? [{ weekday, opensAt: d.opensAt, closesAt: d.closesAt }] : [],
      ),
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Text variant="h2">Opening Hours</Text>
      <Text variant="small">
        24-hour times. Same time twice means open all day; closing after midnight is fine.
      </Text>
      {days.map((d, i) => (
        <View key={DAYS[i]} style={styles.day}>
          <View style={styles.head}>
            <Text variant="strong">{DAYS[i]}</Text>
            <Toggle
              label={`Open on ${DAYS[i]}`}
              value={d.open}
              onChange={(open) => set(i, { open })}
            />
          </View>
          {d.open ? (
            <View style={styles.times}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Opens"
                  value={d.opensAt}
                  onChangeText={(opensAt) => set(i, { opensAt })}
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Closes"
                  value={d.closesAt}
                  onChangeText={(closesAt) => set(i, { closesAt })}
                  autoCapitalize="none"
                />
              </View>
            </View>
          ) : (
            <Text variant="small">Closed</Text>
          )}
        </View>
      ))}
      {problem ? <Alert tone="danger" message={problem} /> : null}
      <Button label="Save Hours" loading={busy} onPress={save} />
    </View>
  );
}

const styles = StyleSheet.create({
  day: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  times: { flexDirection: 'row', gap: 10 },
});
