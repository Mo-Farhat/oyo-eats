import type {
  ItemChangeChoice,
  MarkItemUnavailableInput,
  ReconciliationRun,
  RiderProfile,
  AdminCustomerDetail,
  AdminCustomerSummary,
  AdminReport,
  AuditEntry,
  RestaurantHistory,
  RestaurantReviews,
  RiderIssueInput,
  MyCase,
  RefundInput,
  SupportCase,
  RestaurantPayouts,
  RiderEarnings,
  AdminSettings,
  InAppNotification,
  HoursOverrideInput,
  MenuChangeRequest,
  MenuEditRequestInput,
  RestaurantHours,
  RestaurantMenu,
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
export const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

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
  registerPush: (token: string, platform?: 'ios' | 'android') =>
    api.post<void>('/me/push-token', { token, platform }),
  removePush: (token: string) => api.request<void>('DELETE', '/me/push-token', { body: { token } }),
  notifications: () => api.get<{ items: InAppNotification[]; unread: number }>('/me/notifications'),
  markNotificationsRead: () => api.post<void>('/me/notifications/read'),
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
  answerItemChange: (id: string, changeId: string, choice: ItemChangeChoice) =>
    api.post<OrderDetail>(`/orders/${id}/item-changes/${changeId}`, { choice }),
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
  cancelRequest: (id: string, reason: string) =>
    api.post<MyCase[]>(`/orders/${id}/cancel-request`, { reason }),
  reportProblem: (id: string, form: FormData) => api.post<MyCase[]>(`/orders/${id}/problems`, form),
  cases: (id: string) => api.get<MyCase[]>(`/orders/${id}/cases`),
};

export const restaurantApi = {
  board: () => api.get<RestaurantBoard>('/restaurant/board'),
  accept: (id: string, prepMinutes: number) =>
    api.post<void>(`/restaurant/orders/${id}/accept`, { prepMinutes }),
  reject: (id: string, input: RejectOrderInput) =>
    api.post<void>(`/restaurant/orders/${id}/reject`, input),
  ready: (id: string) => api.post<void>(`/restaurant/orders/${id}/ready`),
  unavailable: (id: string, input: MarkItemUnavailableInput) =>
    api.post<void>(`/restaurant/orders/${id}/unavailable`, input),
  delay: (id: string, minutes: number) =>
    api.post<void>(`/restaurant/orders/${id}/delay`, { minutes }),
  setOpen: (open: boolean, minutes?: 15 | 30 | 60) =>
    api.post<void>('/restaurant/status', { open, minutes }),
  menu: () => api.get<RestaurantMenu>('/restaurant/menu'),
  reviews: () => api.get<RestaurantReviews>('/restaurant/reviews'),
  reply: (id: string, reply: string) =>
    api.post<void>(`/restaurant/reviews/${id}/reply`, { reply }),
  history: (from: string, to: string) =>
    api.get<RestaurantHistory>(`/restaurant/history?from=${from}&to=${to}`),
  historyCsv: (from: string, to: string) =>
    api.get<string>(`/restaurant/history/csv?from=${from}&to=${to}`),
  staff: () => api.get<StaffAccount[]>('/restaurant/staff'),
  addStaff: (input: { displayName: string; username?: string; phone?: string }) =>
    api.post<CreatedAccount>('/restaurant/staff', input),
  resetStaff: (id: string) => api.post<CreatedAccount>(`/restaurant/staff/${id}/reset-password`),
  setStaffActive: (id: string, active: boolean) =>
    api.post<void>(`/restaurant/staff/${id}/status`, { active }),
  decideStaffDevice: (id: string, approve: boolean) =>
    api.post<void>(`/restaurant/staff/devices/${id}/${approve ? 'approve' : 'reject'}`),
  payouts: () => api.get<RestaurantPayouts>('/restaurant/payouts'),
  statement: (id: string) => api.get<SettlementDetail>(`/restaurant/payouts/${id}`),
  statementCsv: (id: string) => api.get<string>(`/restaurant/payouts/${id}/csv`),
  addCategory: (name: string) => api.post<{ id: string }>('/restaurant/menu/categories', { name }),
  addItem: (input: MenuItemInput) =>
    api.post<{ id: string; requestId: string }>('/restaurant/menu/items', input),
  setStock: (itemId: string, soldOut: boolean) =>
    api.post<void>(`/restaurant/menu/items/${itemId}/stock`, { soldOut }),
  requestChange: (itemId: string, input: MenuEditRequestInput) =>
    api.post<{ requestId: string }>(`/restaurant/menu/items/${itemId}/changes`, input),
  requests: () => api.get<MenuChangeRequest[]>('/restaurant/menu/requests'),
  withdraw: (requestId: string) => api.delete<void>(`/restaurant/menu/requests/${requestId}`),
  hours: () => api.get<RestaurantHours>('/restaurant/hours'),
  setHours: (input: HoursInput) => api.put<RestaurantHours>('/restaurant/hours', input),
  addClosure: (input: HoursOverrideInput) =>
    api.post<RestaurantHours>('/restaurant/hours/closures', input),
  removeClosure: (id: string) => api.delete<RestaurantHours>(`/restaurant/hours/closures/${id}`),
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
  menuRequests: () =>
    api.get<{ pending: MenuChangeRequest[]; recent: MenuChangeRequest[] }>('/admin/menu-requests'),
  reviewMenuRequest: (id: string, approve: boolean, note?: string) =>
    api.post<MenuChangeRequest>(`/admin/menu-requests/${id}/review`, { approve, note }),
  settings: () => api.get<AdminSettings>('/admin/settings'),
  saveSettings: (input: AdminSettings) => api.put<AdminSettings>('/admin/settings', input),
  cases: (status: 'open' | 'resolved') => api.get<SupportCase[]>(`/admin/cases?status=${status}`),
  case: (id: string) => api.get<SupportCase>(`/admin/cases/${id}`),
  refundCase: (id: string, input: RefundInput, key: string) =>
    api.post<SupportCase>(`/admin/cases/${id}/refund`, input, { idempotencyKey: key }),
  refundOrder: (id: string, input: RefundInput, key: string) =>
    api.post<SupportCase>(`/admin/orders/${id}/refund`, input, { idempotencyKey: key }),
  resolveCase: (id: string, resolution: string) =>
    api.post<SupportCase>(`/admin/cases/${id}/resolve`, { resolution }),
  refundPaid: (id: string, reference: string | undefined, key: string) =>
    api.post<SupportCase>(`/admin/refunds/${id}/paid`, { reference }, { idempotencyKey: key }),
  customers: (q: string) =>
    api.get<AdminCustomerSummary[]>(
      `/admin/customers${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
    ),
  customer: (id: string) => api.get<AdminCustomerDetail>(`/admin/customers/${id}`),
  flagCustomer: (id: string, note: string | null) =>
    api.post<AdminCustomerDetail>(`/admin/customers/${id}/flag`, { note }),
  setCustomerCod: (id: string, allowed: boolean) =>
    api.post<AdminCustomerDetail>(`/admin/customers/${id}/cod`, { allowed }),
  blockCustomer: (id: string, blocked: boolean, reason?: string) =>
    api.post<AdminCustomerDetail>(`/admin/customers/${id}/block`, { blocked, reason }),
  report: (from: string, to: string) =>
    api.get<AdminReport>(`/admin/reports?from=${from}&to=${to}`),
  reportCsv: (from: string, to: string) =>
    api.get<string>(`/admin/reports/csv?from=${from}&to=${to}`),
  audit: (action?: string) =>
    api.get<AuditEntry[]>(`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`),
  reconciliation: () => api.get<ReconciliationRun[]>('/admin/reconciliation'),
  runReconciliation: () => api.post<ReconciliationRun>('/admin/reconciliation'),
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
  profile: () => api.get<RiderProfile>('/rider/profile'),
  setEmergencyContact: (name: string, phone: string) =>
    api.post<RiderProfile>('/rider/profile/emergency-contact', { name, phone }),
  reportIssue: (orderId: string, input: RiderIssueInput) =>
    api.post<{ id: string }>(`/rider/orders/${orderId}/issue`, input),
  emergency: (input: { lat?: number; lng?: number; description?: string }) =>
    api.post<{ id: string }>('/rider/emergency', { type: 'emergency', ...input }),
  earnings: () => api.get<RiderEarnings>('/rider/earnings'),
  payout: (id: string) => api.get<SettlementDetail>(`/rider/earnings/payouts/${id}`),
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
