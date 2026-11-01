import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import { adminApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { ADMIN_RESTAURANTS } from '@/admin/queries';
import { RestaurantForm } from '@/admin/RestaurantForm';
import { Alert, IconButton, Screen, Text } from '@/components';

/** Add a restaurant (ADM-11). It starts in "Setting up" and isn't listed until it goes live. */
export default function NewRestaurant() {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: adminApi.createRestaurant,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_RESTAURANTS });
      router.replace(`/venue/${r.id}`);
    },
  });
  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Add Restaurant
            </Text>
          </View>
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      <Text variant="muted">
        Customers won’t see it until it goes live. Next you’ll add opening hours, the menu and a
        login for the kitchen tablet.
      </Text>
      {create.error ? <Alert tone="danger" message={errorMessage(create.error)} /> : null}
      <RestaurantForm
        submitLabel="Save and Continue"
        busy={create.isPending}
        onSubmit={(input) => create.mutate(input)}
      />
    </Screen>
  );
}
