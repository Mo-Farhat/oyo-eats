/*
 * Who hears about an order event and what they're told (PRD section 10). Push text never carries
 * an address or a phone number (NOT-05): the app shows those after it opens.
 */

export type Audience = 'customer' | 'rider' | 'restaurant' | 'dispatch';

export interface NotificationTemplate {
  audience: Audience;
  title: string;
  body: string;
  /** Tracked for delivery (NOT-01): new order, job offer, rider assigned. */
  critical?: boolean;
}

export interface OrderEventContext {
  type: string;
  reference: string;
  restaurantName: string;
  paymentMethod: 'cod' | 'bank_transfer' | 'card';
  riderName: string | null;
  prepMinutes: number | null;
  payload: Record<string, unknown>;
  /** Paid by bank transfer before it ended: the customer is owed a refund. */
  prepaid: boolean;
}

const first = (name: string | null) =>
  name ? (name.trim().split(/\s+/)[0] ?? name) : 'Your rider';

export function orderNotifications(e: OrderEventContext): NotificationTemplate[] {
  const ref = `#${e.reference}`;
  const rider = first(e.riderName);
  const reason = typeof e.payload.reason === 'string' ? e.payload.reason : null;
  const nothingCharged = e.prepaid
    ? 'Your bank transfer will be refunded.'
    : 'Nothing was charged.';
  const newOrder: NotificationTemplate = {
    audience: 'restaurant',
    title: `New order ${ref}`,
    body: 'Open the board to accept it.',
    critical: true,
  };
  switch (e.type) {
    case 'placed':
      // Bank-transfer orders reach the kitchen only once the slip is approved.
      return e.paymentMethod === 'bank_transfer' ? [] : [newOrder];
    case 'slip_uploaded':
      return [
        { audience: 'dispatch', title: 'Bank slip to check', body: `${ref} · ${e.restaurantName}` },
      ];
    case 'slip_approved':
      return [
        {
          audience: 'customer',
          title: 'Payment confirmed',
          body: `${ref} is with ${e.restaurantName} now.`,
        },
        newOrder,
      ];
    case 'slip_rejected':
      // An outright rejection is followed by the cancellation, which says so.
      return e.payload.resubmit === false
        ? []
        : [
            {
              audience: 'customer',
              title: 'Please upload a new slip',
              body: reason ?? `We couldn't confirm the payment for ${ref}.`,
            },
          ];
    case 'payment_expired':
      return [
        {
          audience: 'customer',
          title: 'Order cancelled',
          body: `We didn't get a bank slip in time for ${ref}. Nothing was charged.`,
        },
      ];
    case 'restaurant_accepted':
      return [
        {
          audience: 'customer',
          title: `${e.restaurantName} accepted your order`,
          body: e.prepMinutes
            ? `Ready in about ${e.prepMinutes} min.`
            : 'They’re preparing it now.',
        },
      ];
    case 'restaurant_rejected':
    case 'restaurant_timed_out':
      return [
        {
          audience: 'customer',
          title: `${e.restaurantName} couldn't take your order`,
          body: `${ref} was cancelled. ${nothingCharged}`,
        },
      ];
    case 'marked_ready':
      return [
        {
          audience: 'customer',
          title: 'Your food is ready',
          body: e.riderName ? `${rider} is collecting it.` : 'We’re finding a rider for it.',
        },
        ...(e.riderName
          ? [
              {
                audience: 'rider' as const,
                title: `${ref} is ready for pickup`,
                body: `At ${e.restaurantName}.`,
              },
            ]
          : []),
      ];
    case 'offer_sent':
      return [
        {
          audience: 'rider',
          title: 'New job offer',
          body: `Pickup at ${e.restaurantName}. Answer within a minute.`,
          critical: true,
        },
      ];
    case 'offer_accepted':
      return [
        {
          audience: 'customer',
          title: `${rider} is on your order`,
          body: 'Open the app to see your rider and call them.',
          critical: true,
        },
        {
          audience: 'restaurant',
          title: `Rider on the way for ${ref}`,
          body: `${rider} is coming to collect it.`,
        },
      ];
    case 'offer_declined':
      return [
        { audience: 'dispatch', title: `${rider} declined ${ref}`, body: 'Assign another rider.' },
      ];
    case 'offer_expired':
      return [
        {
          audience: 'dispatch',
          title: `Offer for ${ref} timed out`,
          body: 'Assign another rider.',
        },
      ];
    case 'assignment_cancelled':
      return [
        {
          audience: 'rider',
          title: `${ref} was taken off you`,
          body: 'Dispatch has reassigned it.',
        },
      ];
    case 'picked_up':
      return [
        { audience: 'customer', title: 'On the way', body: `${rider} has picked up your order.` },
      ];
    case 'delivered':
      return [
        {
          audience: 'customer',
          title: 'Delivered',
          body: `Enjoy your meal. Tap to rate ${e.restaurantName}.`,
        },
        { audience: 'restaurant', title: `${ref} delivered`, body: `${rider} handed it over.` },
      ];
    case 'cancelled_by_customer':
      return [
        {
          audience: 'restaurant',
          title: `${ref} cancelled`,
          body: 'The customer cancelled before you accepted.',
        },
      ];
    case 'cancelled_by_admin':
      return [
        {
          audience: 'customer',
          title: 'Your order was cancelled',
          body: `${ref}${reason ? `: ${reason}` : ''}. ${nothingCharged}`,
        },
        {
          audience: 'restaurant',
          title: `${ref} cancelled by Oyo Eats`,
          body: reason ?? 'Stop preparing it.',
        },
        ...(e.riderName
          ? [{ audience: 'rider' as const, title: `${ref} cancelled`, body: 'Don’t collect it.' }]
          : []),
      ];
    case 'item_unavailable': {
      const name = String(e.payload.name ?? 'an item');
      const substitute = typeof e.payload.substitute === 'string' ? e.payload.substitute : null;
      return [
        substitute
          ? {
              audience: 'customer',
              title: `${e.restaurantName} is out of ${name}`,
              body: `They can make ${substitute} instead. Open the app to swap or remove it.`,
              critical: true,
            }
          : {
              audience: 'customer',
              title: `${e.restaurantName} is out of ${name}`,
              body: `We took it off ${ref} and changed the total. Open the app to see it.`,
            },
      ];
    }
    case 'item_change_resolved': {
      if (e.payload.by === 'kitchen') return [];
      const name = String(e.payload.name ?? 'the item');
      const substitute = typeof e.payload.substitute === 'string' ? e.payload.substitute : null;
      return [
        {
          audience: 'restaurant',
          title:
            e.payload.choice === 'substitute' && substitute
              ? `${ref}: make ${substitute} instead`
              : `${ref}: leave out ${name}`,
          body:
            e.payload.by === 'timeout'
              ? 'The customer didn’t answer in time.'
              : 'The customer chose this.',
          critical: true,
        },
      ];
    }
    case 'cancelled_items_unavailable':
      return [
        {
          audience: 'customer',
          title: `${e.restaurantName} couldn't make your order`,
          body: `${ref} was cancelled. ${nothingCharged}`,
        },
        { audience: 'restaurant', title: `${ref} cancelled`, body: 'Nothing was left to make.' },
        ...(e.riderName
          ? [{ audience: 'rider' as const, title: `${ref} cancelled`, body: 'Don’t collect it.' }]
          : []),
      ];
    case 'delivery_failed':
      return [
        {
          audience: 'customer',
          title: 'Delivery failed',
          body: `We couldn't deliver ${ref}. The Oyo Eats office will be in touch.`,
        },
      ];
    default:
      return [];
  }
}
