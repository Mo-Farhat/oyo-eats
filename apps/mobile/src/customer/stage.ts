import type { CustomerStage, OrderStatus, PaymentMethod } from '@oyo/shared';

/** Customer-facing words for each tracking step (CUS-11). */
export function stageText(stage: CustomerStage, method?: PaymentMethod): string {
  switch (stage) {
    case 'placed':
      return method === 'bank_transfer' ? 'Waiting for your bank slip' : 'Placed';
    case 'confirmed':
      return 'Waiting for the restaurant';
    case 'preparing':
      return 'Being prepared';
    case 'ready':
      return 'Ready, finding a rider';
    case 'rider_assigned':
      return 'Rider assigned';
    case 'picked_up':
      return 'On the way';
    case 'delivered':
      return 'Delivered';
  }
}

export const STAGE_LABELS: Record<CustomerStage, string> = {
  placed: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  rider_assigned: 'Rider assigned',
  picked_up: 'On the way',
  delivered: 'Delivered',
};

/** Words for orders that left the timeline. */
export function exitText(status: OrderStatus): string | null {
  switch (status) {
    case 'cancelled':
      return 'Cancelled';
    case 'rejected':
      return 'The restaurant couldn’t take this order';
    case 'failed':
      return 'Delivery failed';
    default:
      return null;
  }
}
