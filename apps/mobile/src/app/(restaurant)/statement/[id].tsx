import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Share } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, IconButton, Screen, Text } from '@/components';
import { StatementLines } from '@/payouts/StatementView';

/** T11 statement: orders included and the total, with a CSV to share (RES-11). */
export default function Statement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useQuery({ queryKey: ['statement', id], queryFn: () => restaurantApi.statement(id) });
  const share = useMutation({
    mutationFn: async () => Share.share({ message: await restaurantApi.statementCsv(id) }),
  });
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/payouts'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Statement
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {s.error || share.error ? (
        <Alert tone="danger" message={errorMessage(s.error ?? share.error)} />
      ) : null}
      {s.data ? (
        <>
          <StatementLines d={s.data} />
          <Button
            variant="secondary"
            label="Share as CSV"
            loading={share.isPending}
            onPress={() => share.mutate()}
          />
        </>
      ) : null}
    </Screen>
  );
}
