import { formatLkr, RESTAURANT_REVIEW_TAGS, RIDER_REVIEW_TAGS } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  BottomBar,
  Button,
  Card,
  Chip,
  Icon,
  Screen,
  Stars,
  Text,
  TextField,
} from '@/components';
import { keys, useOrder } from '@/customer/queries';
import { colors } from '@/theme/tokens';

function TagPicker<T extends string>({
  tags,
  value,
  onChange,
}: {
  tags: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <View style={styles.chips}>
      {tags.map((t) => {
        const on = value.includes(t);
        return (
          <Pressable
            key={t}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(on ? value.filter((x) => x !== t) : [...value, t])}
          >
            <Chip label={t} tone={on ? 'green' : 'neutral'} />
          </Pressable>
        );
      })}
    </View>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-LK', {
    timeZone: 'Asia/Colombo',
    hour: 'numeric',
    minute: '2-digit',
  });

/** C12: delivered, rate the food and the rider (CUS-16). Editable for 24 hours. */
export default function Rate() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const order = useOrder(id);
  const o = order.data;
  const [food, setFood] = useState(0);
  const [foodTags, setFoodTags] = useState<(typeof RESTAURANT_REVIEW_TAGS)[number][]>([]);
  const [comment, setComment] = useState('');
  const [rider, setRider] = useState(0);
  const [riderTags, setRiderTags] = useState<(typeof RIDER_REVIEW_TAGS)[number][]>([]);

  // Editing: start from what was given before.
  useEffect(() => {
    if (!o) return;
    if (o.ratings.restaurant) {
      setFood(o.ratings.restaurant.rating);
      setFoodTags(o.ratings.restaurant.tags as typeof foodTags);
      setComment(o.ratings.restaurant.body ?? '');
    }
    if (o.ratings.rider) {
      setRider(o.ratings.rider.rating);
      setRiderTags(o.ratings.rider.tags as typeof riderTags);
    }
  }, [o?.id]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/orders'));
  const submit = useMutation({
    mutationFn: () =>
      customerApi.rate(id, {
        restaurant: { rating: food, tags: foodTags, body: comment.trim() || undefined },
        ...(o?.rider && rider ? { rider: { rating: rider, tags: riderTags } } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.order(id) });
      await queryClient.invalidateQueries({ queryKey: keys.orders });
      leave();
    },
  });

  const deliveredAt = o?.timeline.find((e) => e.type === 'delivered')?.at;

  return (
    <Screen
      top={
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Button variant="ghost" label="Skip" onPress={leave} />
        </View>
      }
      footer={
        <BottomBar>
          <Button
            label="Submit Ratings"
            onPress={() => submit.mutate()}
            loading={submit.isPending}
            disabled={!food || !o?.canRate}
          />
        </BottomBar>
      }
      bodyStyle={{ gap: 14 }}
    >
      {o ? (
        <>
          <View style={styles.hero}>
            <View style={styles.done}>
              <Icon name="check" size={28} color="#ffffff" />
            </View>
            <Text variant="h1" accessibilityRole="header">
              Delivered. Enjoy!
            </Text>
            <Text variant="muted">
              {[
                `#${o.reference}`,
                deliveredAt ? time(deliveredAt) : null,
                `${formatLkr(o.totalCents)} ${o.paymentMethod === 'cod' ? 'paid in cash' : 'paid by transfer'}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Card style={{ gap: 10 }}>
            <Text variant="strong">How was {o.restaurant.name}?</Text>
            <Stars label="Food rating" value={food} onChange={setFood} />
            <TagPicker tags={RESTAURANT_REVIEW_TAGS} value={foodTags} onChange={setFoodTags} />
            <TextField
              label="Comment for the restaurant (optional)"
              value={comment}
              onChangeText={setComment}
              maxLength={500}
              multiline
              style={{ height: 88, paddingTop: 12, textAlignVertical: 'top' }}
            />
          </Card>
          {o.rider ? (
            <Card style={{ gap: 10 }}>
              <Text variant="strong">How was {o.rider.name}, your rider?</Text>
              <Stars label="Rider rating" value={rider} onChange={setRider} />
              <TagPicker tags={RIDER_REVIEW_TAGS} value={riderTags} onChange={setRiderTags} />
            </Card>
          ) : null}
          {!o.canRate ? (
            <Alert message="The 24-hour window to rate this order has passed." />
          ) : null}
          {submit.error ? <Alert tone="danger" message={errorMessage(submit.error)} /> : null}
          <Text variant="small">You can edit your rating for 24 hours.</Text>
        </>
      ) : order.error ? (
        <Alert tone="danger" message={errorMessage(order.error)} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8 },
  done: {
    width: 64,
    height: 64,
    borderRadius: 9999,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
