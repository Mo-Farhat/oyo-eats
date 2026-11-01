/** pg-boss queue names for order timers. */
export const ORDER_QUEUES = {
  restaurantTimeout: 'order.restaurant-timeout',
  paymentTimeout: 'order.payment-timeout',
} as const;
