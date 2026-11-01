import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartModifier {
  id: string;
  name: string;
  priceCents: number;
}

export interface CartLine {
  /** Same item with the same options and note merges into one line. */
  key: string;
  menuItemId: string;
  name: string;
  unitPriceCents: number;
  modifiers: CartModifier[];
  quantity: number;
  note?: string;
}

export interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
  /** Address the customer is ordering to (C01). */
  addressId: string | null;
  recentSearches: string[];
  add(restaurant: { id: string; name: string }, line: Omit<CartLine, 'key'>): void;
  setQuantity(key: string, quantity: number): void;
  clear(): void;
  setAddress(id: string | null): void;
  rememberSearch(q: string): void;
}

const lineKey = (l: Omit<CartLine, 'key'>) =>
  [l.menuItemId, ...l.modifiers.map((m) => m.id).sort(), l.note?.trim() ?? ''].join('|');

/**
 * Cart, delivery address and recent searches. One restaurant per cart (CUS-06); the screen asks
 * before replacing a cart from another restaurant. Persisted so a cart survives restarts.
 */
export const useCustomer = create<CartState>()(
  persist(
    (set, get) => ({
      restaurantId: null,
      restaurantName: null,
      lines: [],
      addressId: null,
      recentSearches: [],

      add(restaurant, line) {
        const sameRestaurant = get().restaurantId === restaurant.id;
        const lines = sameRestaurant ? get().lines : [];
        const key = lineKey(line);
        const existing = lines.find((l) => l.key === key);
        set({
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          lines: existing
            ? lines.map((l) =>
                l.key === key ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l,
              )
            : [...lines, { ...line, key }],
        });
      },

      setQuantity(key, quantity) {
        const lines =
          quantity <= 0
            ? get().lines.filter((l) => l.key !== key)
            : get().lines.map((l) =>
                l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l,
              );
        set(lines.length ? { lines } : { lines, restaurantId: null, restaurantName: null });
      },

      clear() {
        set({ lines: [], restaurantId: null, restaurantName: null });
      },

      setAddress(id) {
        set({ addressId: id });
      },

      rememberSearch(q) {
        const term = q.trim().toLowerCase();
        if (!term) return;
        set({
          recentSearches: [term, ...get().recentSearches.filter((s) => s !== term)].slice(0, 6),
        });
      },
    }),
    { name: 'oyo.customer', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const lineTotal = (l: CartLine) =>
  (l.unitPriceCents + l.modifiers.reduce((sum, m) => sum + m.priceCents, 0)) * l.quantity;

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);
export const cartSubtotal = (lines: CartLine[]) => lines.reduce((sum, l) => sum + lineTotal(l), 0);
