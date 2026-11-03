import { can, formatLkr } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { Alert, Card, Screen, Text } from '@/components';
import { StatementRow } from '@/payouts/StatementView';

/** T11 (RES-11): what Oyo Eats owes the restaurant, and the weekly statements. Owner only. */
export default function Payouts() {
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'restaurant.payouts.view');
  const payouts = useQuery({
    queryKey: ['restaurant-payouts'],
    queryFn: restaurantApi.payouts,
    enabled: owner,
  });
  const p = payouts.data;
  return (
    <Screen inTabs bodyStyle={{ gap: 12, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Payouts
      </Text>
      {!owner ? (
        <Card>
          <Text variant="muted">Payouts are for the restaurant owner’s login.</Text>
        </Card>
      ) : null}
      {payouts.error ? <Alert tone="danger" message={errorMessage(payouts.error)} /> : null}
      {p ? (
        <>
          <Card style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="label">Owed for orders not yet on a statement</Text>
            <Text variant="big">{formatLkr(p.pending.amountCents)}</Text>
            <Text variant="small">
              {p.pending.orderCount
                ? `${p.pending.orderCount} delivered ${p.pending.orderCount === 1 ? 'order' : 'orders'}. Statements are made weekly, Monday to Sunday, and paid to your bank account.`
                : 'Nothing waiting. Delivered orders show up here.'}
            </Text>
          </Card>
          {p.statements.length ? <Text variant="label">Statements</Text> : null}
          {p.statements.map((s) => (
            <StatementRow key={s.id} s={s} onPress={() => router.push(`/statement/${s.id}`)} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
