import type { RestaurantReview } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  Button,
  Card,
  Chip,
  IconButton,
  Screen,
  Stars,
  Text,
  TextField,
} from '@/components';

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Colombo',
  });

function ReviewCard({ r }: { r: RestaurantReview }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.reply ?? '');
  const reply = useMutation({
    mutationFn: () => restaurantApi.reply(r.id, text.trim()),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['restaurant-reviews'] });
    },
  });
  return (
    <Card style={{ gap: 6, opacity: r.hidden ? 0.6 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Stars value={r.rating} size={16} label={`${r.rating} stars`} />
        <Text variant="small">{`${r.author} · #${r.orderReference} · ${when(r.createdAt)}`}</Text>
      </View>
      {r.tags.length ? <Text variant="small">{r.tags.join(' · ')}</Text> : null}
      {r.body ? <Text variant="body">{r.body}</Text> : null}
      {r.hidden ? <Chip label="Hidden by Oyo Eats" style={{ alignSelf: 'flex-start' }} /> : null}
      {r.reply && !editing ? (
        <View style={{ gap: 2 }}>
          <Text variant="label">Your reply</Text>
          <Text variant="body">{r.reply}</Text>
          <Button small variant="ghost" label="Edit Reply" onPress={() => setEditing(true)} />
        </View>
      ) : editing ? (
        <>
          <TextField
            label="Your reply (customers see it)"
            value={text}
            onChangeText={setText}
            multiline
          />
          {reply.error ? <Alert tone="danger" message={errorMessage(reply.error)} /> : null}
          <Button
            small
            label="Post Reply"
            disabled={text.trim().length < 2}
            loading={reply.isPending}
            onPress={() => reply.mutate()}
          />
        </>
      ) : (
        <Button small variant="ghost" label="Reply" onPress={() => setEditing(true)} />
      )}
    </Card>
  );
}

/** T12 (RES-12): what customers say, with a public reply. */
export default function KitchenReviews() {
  const reviews = useQuery({ queryKey: ['restaurant-reviews'], queryFn: restaurantApi.reviews });
  const d = reviews.data;
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Reviews
            </Text>
            {d ? (
              <Text variant="small">
                {d.rating ? `${d.rating.toFixed(1)} from ${d.count} reviews` : 'No reviews yet'}
              </Text>
            ) : null}
          </View>
        </>
      }
      bodyStyle={{ gap: 10 }}
    >
      {reviews.error ? <Alert tone="danger" message={errorMessage(reviews.error)} /> : null}
      {d?.reviews.map((r) => (
        <ReviewCard key={r.id} r={r} />
      ))}
      {d && d.reviews.length === 0 ? (
        <Text variant="muted">Customers’ ratings show up here after delivery.</Text>
      ) : null}
    </Screen>
  );
}
