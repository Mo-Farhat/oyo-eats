import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, IconButton, Screen, Text } from '@/components';
import { StatementLines } from '@/payouts/StatementView';

/** R10 payout: the deliveries in one weekly payout. */
export default function Payout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = useQuery({ queryKey: ['payout', id], queryFn: () => riderApi.payout(id) });
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/earnings'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Payout
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {p.error ? <Alert tone="danger" message={errorMessage(p.error)} /> : null}
      {p.data ? <StatementLines d={p.data} /> : null}
    </Screen>
  );
}
