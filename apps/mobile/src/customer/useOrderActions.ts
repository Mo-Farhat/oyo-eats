import type { OrderDetail } from '@oyo/shared';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Linking } from 'react-native';
import { customerApi } from '@/api';
import { reorder } from './reorder';

/** Reorder and receipt actions shared by the order screen and the history list (C13). */
export function useOrderActions() {
  const again = useMutation({
    mutationFn: async (o: OrderDetail | string) =>
      reorder(typeof o === 'string' ? await customerApi.order(o) : o),
    onSuccess: (result) => {
      if (result.added) router.push('/cart');
    },
  });
  const receipt = useMutation({
    mutationFn: async (id: string) => {
      const { url } = await customerApi.receipt(id);
      await Linking.openURL(url);
    },
  });
  return { again, receipt };
}
