import { formatLkr } from '@oyo/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  BottomBar,
  Button,
  Card,
  Icon,
  IconButton,
  Photo,
  PriceRow,
  Screen,
  Stepper,
  Text,
} from '@/components';
import { useQuote } from '@/customer/queries';
import { cartSubtotal, lineTotal, useCustomer } from '@/customer/store';
import { colors, fonts } from '@/theme/tokens';

/** C06: the cart. Prices are re-checked by the server quote; the fee is fixed at checkout. */
export default function Cart() {
  const cart = useCustomer();
  const quote = useQuote();
  const q = quote.data;

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Your Cart
          </Text>
          {cart.lines.length ? <Button variant="ghost" label="Clear" onPress={cart.clear} /> : null}
        </>
      }
      footer={
        cart.lines.length ? (
          <BottomBar>
            <Button
              label="Go to Checkout"
              onPress={() => router.push('/checkout')}
              disabled={!q || !!quote.error}
            />
          </BottomBar>
        ) : null
      }
      bodyStyle={{ gap: 14 }}
    >
      {cart.lines.length === 0 ? (
        <>
          <Text variant="muted">Your cart is empty.</Text>
          <Button variant="secondary" label="Find Food" onPress={() => router.replace('/home')} />
        </>
      ) : (
        <>
          <View style={styles.restaurant}>
            <Photo size={40} />
            <View>
              <Text variant="strong">{cart.restaurantName}</Text>
              {q ? (
                <Text variant="small">{`About ${(q.routeMeters / 1000).toFixed(1)} km by road`}</Text>
              ) : null}
            </View>
          </View>

          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {cart.lines.map((l, i) => (
              <View
                key={l.key}
                style={[styles.line, i === cart.lines.length - 1 && { borderBottomWidth: 0 }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="strong">{l.name}</Text>
                  {l.modifiers.length || l.note ? (
                    <Text variant="small">
                      {[l.modifiers.map((m) => m.name).join(', '), l.note ? `“${l.note}”` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <Text variant="strong">{formatLkr(lineTotal(l))}</Text>
                  <Stepper
                    compact
                    min={1}
                    label={l.name}
                    value={l.quantity}
                    onChange={(v) => cart.setQuantity(l.key, v)}
                  />
                </View>
              </View>
            ))}
          </Card>

          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.more}>
            <Icon name="plus" size={16} />
            <Text style={styles.moreText}>Add more items</Text>
          </Pressable>

          <Card style={{ gap: 4 }}>
            <PriceRow label="Subtotal" cents={q?.itemsCents ?? cartSubtotal(cart.lines)} />
            {q ? (
              <PriceRow
                label={`Delivery (est. ${(q.routeMeters / 1000).toFixed(1)} km)`}
                cents={q.deliveryFeeCents}
              />
            ) : null}
            {q ? (
              <Text variant="small">
                {`Final delivery fee is fixed at checkout: ${formatLkr(q.baseFeeCents)} + ${formatLkr(q.perKmCents)} per km.`}
              </Text>
            ) : null}
          </Card>
          {quote.error ? <Alert tone="danger" message={errorMessage(quote.error)} /> : null}
          <Alert
            tone="info"
            message="One restaurant per cart. Adding from another place asks to start a new cart."
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  restaurant: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  more: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  moreText: { fontFamily: fonts.sans700, color: colors.strong, fontSize: 14 },
});
