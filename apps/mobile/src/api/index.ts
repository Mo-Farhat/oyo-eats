import type {
  SettlementDetail,
  SettlementSummary,
  AdminRiderDetail,
  AdminRiderSummary,
  CashHandoverInput,
  AdminOrderDetail,
  AdminRestaurantDetail,
  AdminRestaurantSummary,
  CreateAccountInput,
  CreatedAccount,
  HoursInput,
  MenuItemInput,
  MenuItemUpdate,
  RestaurantInput,
  RestaurantUpdate,
  Role,
  StaffAccount,
  AddressInput,
  AssignmentLock,
  CandidateRider,
  DispatchBoard,
  RiderState,
  SlipReviewItem,
  AddressResponse,
  MeResponse,
  OrderDetail,
  OrderSummary,
  PlaceOrderInput,
  ProfileResponse,
  ProfileUpdateInput,
  RateOrderInput,
  RejectOrderInput,
  RestaurantBoard,
  ReviewResponse,
  QuoteOrderInput,
  QuoteResponse,
  RestaurantDetail,
  RestaurantSummary,
  SignInResponse,
  StaffLoginInput,
  TokensResponse,
  TotpSetupResponse,
} from '@oyo/shared';
import { Platform } from 'react-native';
import { useSession } from '@/auth/session';
import { createApiClient } from './client';

export { ApiRequestError } from './client';

/** Set EXPO_PUBLIC_API_URL in apps/mobile/.env (a phone needs your computer's LAN address). */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const api = createApiClient({
  baseUrl,
  getTokens: () => useSession.getState().session?.tokens ?? null,
  getDeviceId: () => useSession.getState().deviceId,
  onTokens: (tokens: TokensResponse) => useSession.getState().setTokens(tokens),
  onSessionEnded: () => useSession.getState().signOut(),
});

const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : undefined;

export const authApi = {
  requestOtp: (phone: string) =>
    api.post<{ resendAfterSeconds: number }>('/auth/otp/request', { phone }, { auth: false }),
  verifyOtp: (input: { phone: string; code: string; acceptTerms?: boolean }) =>
    api.post<SignInResponse>(
      '/auth/otp/verify',
      { ...input, deviceId: useSession.getState().deviceId },
      { auth: false },
    ),
  login: (input: Pick<StaffLoginInput, 'username' | 'password' | 'totpCode'>) =>
    api.post<SignInResponse>(
      '/auth/login',
      { ...input, deviceId: useSession.getState().deviceId, platform },
      { auth: false },
    ),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<SignInResponse>('/auth/password', { currentPassword, newPassword }),
  startTotp: () => api.post<TotpSetupResponse>('/auth/totp/setup'),
  confirmTotp: (code: string) => api.post<SignInResponse>('/auth/totp/confirm', { code }),
  me: () => api.get<MeResponse>('/auth/me'),
  logout: () => api.post<void>('/auth/logout'),
};

export const customerApi = {
  addresses: () => api.get<AddressResponse[]>('/me/addresses'),
  addAddress: (input: AddressInput) => api.post<AddressResponse>('/me/addresses', input),
  restaurants: (q: { lat: number; lng: number; q?: string; cuisine?: string }) => {
    const params = new URLSearchParams({ lat: String(q.lat), lng: String(q.lng) });
    if (q.q) params.set('q', q.q);
    if (q.cuisine) params.set('cuisine', q.cuisine);
    return api.get<RestaurantSummary[]>(`/restaurants?${params}`);
  },
  restaurant: (id: string, at?: { lat: number; lng: number }) =>
    api.get<RestaurantDetail>(`/restaurants/${id}${at ? `?lat=${at.lat}&lng=${at.lng}` : ''}`),
  quote: (draft: QuoteOrderInput) => api.post<QuoteResponse>('/orders/quote', draft),
  placeOrder: (input: PlaceOrderInput, idempotencyKey: string) =>
    api.post<OrderDetail>('/orders', input, { idempotencyKey }),
  orders: () => api.get<OrderSummary[]>('/orders'),
  order: (id: string) => api.get<OrderDetail>(`/orders/${id}`),
  cancelOrder: (id: string) => api.post<OrderDetail>(`/orders/${id}/cancel`),
  rate: (id: string, input: RateOrderInput) => api.post<void>(`/orders/${id}/ratings`, input),
  receipt: (id: string) => api.post<{ url: string }>(`/orders/${id}/receipt`),
  reviews: (restaurantId: string) =>
    api.get<ReviewResponse[]>(`/restaurants/${restaurantId}/reviews`),
  profile: () => api.get<ProfileResponse>('/me/profile'),
  updateProfile: (input: ProfileUpdateInput) => api.patch<ProfileResponse>('/me/profile', input),
  requestPhoneChange: (phone: string) =>
    api.post<{ resendAfterSeconds: number }>('/me/phone/request', { phone }),
  verifyPhoneChange: (phone: string, code: string) =>
    api.post<void>('/me/phone/verify', { phone, code }),
  deleteAccount: () => api.delete<void>('/me'),
  deleteAddress: (id: string) => api.delete<void>(`/me/addresses/${id}`),
  /** C08: multipart upload of the slip photo (field "slip"). */
  uploadSlip: (id: string, form: FormData) => api.post<void>(`/orders/${id}/slip`, form),
};

export const restaurantApi = {
  board: () => api.get<RestaurantBoard>('/restaurant/board'),
  accept: (id: string, prepMinutes: number) =>
    api.post<void>(`/restaurant/orders/${id}/accept`, { prepMinutes }),
  reject: (id: string, input: RejectOrderInput) =>
    api.post<void>(`/restaurant/orders/${id}/reject`, input),
  ready: (id: string) => api.post<void>(`/restaurant/orders/${id}/ready`),
  delay: (id: string, minutes: number) =>
    api.post<void>(`/restaurant/orders/${id}/delay`, { minutes }),
  setOpen: (open: boolean) => api.post<void>('/restaurant/status', { open }),
};

export const dispatchApi = {
  board: () => api.get<DispatchBoard>('/admin/board'),
  candidates: (orderId: string) => api.get<CandidateRider[]>(`/admin/orders/${orderId}/candidates`),
  lock: (orderId: string) => api.post<AssignmentLock>(`/admin/orders/${orderId}/lock`),
  offer: (orderId: string, riderId: string) =>
    api.post<{ offerId: string; expiresAt: string }>(`/admin/orders/${orderId}/offer`, { riderId }),
  cancelOffer: (offerId: string) => api.post<void>(`/admin/offers/${offerId}/cancel`),
  slips: () => api.get<SlipReviewItem[]>('/admin/slips'),
  order: (id: string) => api.get<AdminOrderDetail>(`/admin/orders/${id}`),
  cancelOrder: (id: string, reason: string) =>
    api.post<AdminOrderDetail>(`/admin/orders/${id}/cancel`, { reason }),
  markFailed: (id: string, reason: string) =>
    api.post<AdminOrderDetail>(`/admin/orders/${id}/failed`, { reason }),
  riders: () => api.get<AdminRiderSummary[]>('/admin/riders'),
  rider: (id: string) => api.get<AdminRiderDetail>(`/admin/riders/${id}`),
  handover: (id: string, input: CashHandoverInput, key: string) =>
    api.post<AdminRiderDetail>(`/admin/riders/${id}/handover`, input, { idempotencyKey: key }),
  countersign: (handoverId: string) =>
    api.post<AdminRiderDetail>(`/admin/handovers/${handoverId}/countersign`),
  forceOffline: (id: string) => api.post<AdminRiderDetail>(`/admin/riders/${id}/offline`),
  settlements: (party: 'restaurant' | 'rider') =>
    api.get<SettlementSummary[]>(`/admin/settlements?party=${party}`),
  settlement: (id: string) => api.get<SettlementDetail>(`/admin/settlements/${id}`),
  generateSettlements: (party: 'restaurant' | 'rider', periodStart: string) =>
    api.post<SettlementSummary[]>('/admin/settlements/generate', { party, periodStart }),
  reviewSettlement: (id: string) => api.post<SettlementDetail>(`/admin/settlements/${id}/review`),
  paySettlement: (id: string, reference: string | undefined, key: string) =>
    api.post<SettlementDetail>(
      `/admin/settlements/${id}/paid`,
      { reference },
      { idempotencyKey: key },
    ),
  settlementCsv: (id: string) => api.get<string>(`/admin/settlements/${id}/csv`),
  approveSlip: (slipId: string) => api.post<void>(`/admin/slips/${slipId}/approve`),
  rejectSlip: (slipId: string, reason: string, resubmit: boolean) =>
    api.post<void>(`/admin/slips/${slipId}/reject`, { reason, resubmit }),
};

/** Onboarding: logins (ADM-08) and restaurants (ADM-11, ADM-12). */
export const adminApi = {
  accounts: (filter: { role?: Role; tenantId?: string } = {}) => {
    const q = new URLSearchParams(
      Object.entries(filter).filter(([, v]) => v) as [string, string][],
    );
    return api.get<StaffAccount[]>(`/admin/accounts${q.size ? `?${q}` : ''}`);
  },
  createAccount: (input: CreateAccountInput) => api.post<CreatedAccount>('/admin/accounts', input),
  resetPassword: (id: string) => api.post<CreatedAccount>(`/admin/accounts/${id}/reset-password`),
  setActive: (id: string, active: boolean) =>
    api.post<void>(`/admin/accounts/${id}/status`, { active }),
  decideDevice: (id: string, approve: boolean) =>
    api.post<void>(`/admin/devices/${id}/${approve ? 'approve' : 'reject'}`),
  restaurants: () => api.get<AdminRestaurantSummary[]>('/admin/restaurants'),
  restaurant: (id: string) => api.get<AdminRestaurantDetail>(`/admin/restaurants/${id}`),
  createRestaurant: (input: RestaurantInput) =>
    api.post<AdminRestaurantDetail>('/admin/restaurants', input),
  updateRestaurant: (id: string, input: RestaurantUpdate) =>
    api.patch<AdminRestaurantDetail>(`/admin/restaurants/${id}`, input),
  setRestaurantStatus: (id: string, status: AdminRestaurantSummary['status']) =>
    api.post<AdminRestaurantDetail>(`/admin/restaurants/${id}/status`, { status }),
  setHours: (id: string, input: HoursInput) =>
    api.post<AdminRestaurantDetail>(`/admin/restaurants/${id}/hours`, input),
  addCategory: (id: string, name: string, sortOrder = 0) =>
    api.post<{ id: string }>(`/admin/restaurants/${id}/categories`, { name, sortOrder }),
  addItem: (id: string, input: MenuItemInput) =>
    api.post<{ id: string }>(`/admin/restaurants/${id}/items`, input),
  updateItem: (id: string, itemId: string, input: MenuItemUpdate) =>
    api.patch<void>(`/admin/restaurants/${id}/items/${itemId}`, input),
};

export const riderApi = {
  state: () => api.get<RiderState>('/rider/state'),
  setOnline: (online: boolean) => api.post<void>('/rider/status', { online }),
  location: (input: { lat: number; lng: number; mock?: boolean }) =>
    api.post<void>('/rider/location', input),
  accept: (offerId: string) => api.post<void>(`/rider/offers/${offerId}/accept`),
  decline: (offerId: string, reason: string) =>
    api.post<void>(`/rider/offers/${offerId}/decline`, { reason }),
  pickup: (orderId: string) => api.post<void>(`/rider/orders/${orderId}/pickup`),
  deliver: (orderId: string, input: { cashCollectedCents?: number; varianceReason?: string }) =>
    api.post<void>(`/rider/orders/${orderId}/deliver`, input),
};
