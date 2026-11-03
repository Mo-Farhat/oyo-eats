# Roadmap

The build order agreed on 2026-11-01. Scope comes from the PRD; this file only sets the order. Card payments are deferred, everything else follows the PRD.

## Milestone 1: Foundation

- [x] Monorepo: npm workspaces, Turborepo, shared `tsconfig`, lint and format, `.env.example`
- [x] `packages/shared`
  - [x] Money helpers (integer cents, LKR formatting)
  - [x] Delivery fee engine, with tests against the PRD examples
  - [x] Order state machine (two tracks, exit states, actor guards), with a test for every transition and every rejected transition
  - [x] Roles and permissions map
  - [x] Zod schemas for API inputs; Sri Lankan mobile number validation
- [x] `apps/api` (NestJS)
  - [x] Postgres connection, Drizzle schema and migrations for the core entities in PRD section 14
  - [x] Tenant id on tenant-owned rows, RLS policies
  - [x] Order events table (append-only), ledger entries (append-only, double-entry), audit log
  - [x] Auth: customer phone OTP; staff username + password (Argon2id) with forced reset; TOTP 2FA for owner, dispatcher and restaurant owner; access and refresh tokens with reuse detection; device binding
  - [x] Role and object-level guards, deny by default
  - [x] Idempotency-key middleware for money-moving endpoints
  - [x] pg-boss setup for timers
  - [x] Seed script: owner account, settings defaults, demo restaurants
- [x] `apps/mobile` (Expo)
  - [x] Expo Router with one route group per face, picked by the role after login
  - [x] Theme from the design tokens; fonts; base components (button, card, chip, input, nav bar, alert)
  - [x] Login screens S02–S05; tokens kept in the secure store
  - [x] API client with TanStack Query

## Milestone 2: Customer (C01–C15)

- [x] API: settings loader, routing behind an adapter (straight-line placeholder), restaurant list and menu (open now, radius, search, cuisine), saved addresses (encrypted), server-side quote, order placement (idempotent, limits, snapshots), order view and history, customer cancel, restaurant-response and payment-window timers
- [x] C01 location (GPS pin; map and street search wait for the Google key), C02 home, C03 search, C04 restaurant, C05 item sheet, C06 cart (one restaurant, survives restarts), C07 checkout (server fee, COD and bank transfer)
- [x] C09 order status (first pass: timeline, totals, cancel, polling)
- [x] C08 bank transfer: business bank details, slip upload (private storage, EXIF stripped, duplicate guard), expiry countdown; API for the A12 review queue (approve, reject or ask for a new slip); refund case opened when a paid transfer is cancelled
- [x] C10 rider-assigned pop-up with the rider's name, vehicle and phone; Call button on the order while the delivery is open
- [x] Live updates: order events and menu requests notify on commit (Postgres NOTIFY) → Socket.IO rooms per account, kitchen, dispatch and reviewer → the app refetches the affected screens (new order on the kitchen board in under a second); polling stays as a slower fallback
- [x] Push and in-app notifications: templates per event and audience in `@oyo/shared` (no address or phone in text), one row per person (in-app list, 30 days), pushed through Expo when configured (logged in development), dead tokens dropped; customer bell and Notifications screen; phones register once the EAS project exists
- [ ] C09 live map, C11 live delivery map (needs rider location from Milestone 5 to be meaningful)
- [x] C12 delivered and rating (editable 24 h), reviews on restaurant pages (CUS-20)
- [x] C13 history: reorder, receipt PDF
- [x] C14 ask to cancel after the restaurant accepts (a support case), C19 report a problem with up to 3 photos (re-encoded), the customer's cases and refunds on the order
- [x] C15 profile: name, verified phone change, notification settings, delete account (PRI-06)

## Milestone 3: Restaurant (T01–T12)

- [x] API: board (tenant-scoped under RLS), accept with prep time, reject with reason (and mark items sold out), mark ready, running-late delay, Open switch (pause until reopened); customer sees the promised ready time
- [x] T01 board (New / Preparing / Ready / Done, kept awake), T02 full-screen new-order alarm with looping sound (foreground), T03 accept, T04 reject sheet, T05 preparing (countdown, checklist, delay, mark ready), T06 handover number
- [ ] Alarm with the screen locked and the app in the background (Notifee, needs a development build)
- [x] Mark an item unavailable mid-order, with the customer substitution or partial refund flow (RES-05)
- [x] T07 menu by category with instant stock switches, T08 add item / change a live item (name, description, price, category) as a request, T09 change requests with withdraw and Oyo Eats' notes (RES-08, RES-09)
- [x] T10 hours: pause 15/30/60 min or until reopened, weekly schedule, special closures and special hours (RES-10)
- [ ] Menu photos; editing choice groups on a live item; marking a single option sold out
- [x] T11 payouts (owner): owed so far, weekly statements with orders and refunds netted, CSV
- [x] T12: reviews with public replies (RES-12, office can hide abusive ones), sales and order history by day with CSV (RES-13), owner-managed kitchen staff logins and tablet approval (RES-01)
- [ ] Tablet layout for the counter (section 6)

## Milestone 4: Admin and dispatch (A01–A22)

- [x] API: dispatch board (late flag on unassigned orders), eligible riders sorted per section 8, 30 s soft lock, offer with pay fixed at offer time, cancel offer, offer expiry timer
- [x] API: slip review queue (A12), from Milestone 2
- [x] Screens: A01 board, A03 assign list (takes the soft lock), A06 offer pending with cancel
- [x] A02 order detail: customer and rider contacts with Call, timeline with who and why, offer history, items and money; cancel with a reason (open offers withdrawn, refund case for a paid transfer) and delivery failed
- [ ] Screens: A04 assign map, A05 batch builder, A07 live map
- [x] Onboarding (ADM-08, ADM-11, ADM-12, ADM-19): A10 create logins (rider, restaurant, dispatcher; one-time password shown once), People tab (reset password, switch off, approve new devices), A13 restaurants list, add restaurant, A14 setup (profile, licence, payout bank, hours, menu entered as approved, logins, go live once nothing blocks it, suspend)
- [x] A08 riders (online/offline/suspended, search, no-signal and cash-cap flags), A09 rider detail (contact, stats, jobs, cash on hand, handovers, low ratings, reset, force offline, suspend; blocked mid-job), A11 cash handover (COD orders since the last handover, expected vs received, reason for any difference, owner sign-off); R11 shows the rider their handovers and the cap from settings
- [x] A12 bank slip screen: slip image, amount and reference, countdown, approve, ask for a new slip with a reason, or reject outright (cancels the order, payment marked failed)
- [x] Ledger postings (double-entry, in the same transaction as the event): delivery (rider cash or customer prepayment → restaurant payable + fee revenue, cash variance), rider pay, bank transfer approved, cash handover, settlement paid. `npm run db:backfill-ledger -w @oyo/api` posts older dev data
- [x] A16/A17 weekly restaurant statements and rider payouts: build last week's drafts (each order settled once), review, mark paid (checksum, frozen, ledger), share as CSV
- [x] A15 menu approvals: before and after, approve live instantly, reject with a note (ADM-12)
- [x] A18 customers: search by any local phone format or name, orders, refunds, open cases, office note, COD switch (applied at checkout), block (owner; signs out at once)
- [x] Nightly books check (03:30): deliveries, rider pay, approved transfers, cash handovers and paid refunds against the ledger, rider cash both ways; differences flagged to the owner; shown on Reports with "check again"
- [ ] Rider deductions and adjustments
- [x] A20 settings (fees, radius, minimum order, COD limit, timers, rider caps, rider share, dispatcher refund cap, business bank account), audited
- [x] A22 support queue and case detail: photos, reporter contact, refunds (reason code, who bears it, dispatcher cap, owner above it), owner marks transferred, close with a note to the customer; Refund on A02 too. Refunds charged to a restaurant or rider are netted off their next statement
- [x] A19 reports (orders, money, cash position from the ledger, delivery and accept times, failure reasons, per restaurant and rider, CSV) and the audit log screen (SEC-31)
- [ ] A21 staff roles beyond logins, broadcast; re-authentication for refunds over the cap (SEC-13)
- [x] Unassigned alert: every dispatcher gets one critical push per order past the alert time; notification lists for rider, kitchen and admin
- [x] SMS fallback: critical notifications that can't be pushed (no app push, or failed) go by SMS (NOT-01)
- [ ] Push delivery receipts (a sent push not delivered in 20 s → SMS), owner-editable message templates (NOT-05)

## Milestone 5: Rider (R01–R13)

- [x] API: online/offline (blocked mid-job), location reports with mock flag, current offer (area only), accept, decline with reason, expiry with the three-miss rule, pickup (needs ready), deliver with COD cash and variance reason, cash held
- [x] Screens: R01/R02 offline and online, R03 offer with 60 s countdown and ring, R04 decline reasons, R05–R08 to restaurant, pickup, to customer, complete (swipe-only status changes, COD cash entry); R11 cash on hand (first pass); foreground location reports
- [x] R10 earnings (today, week, owed, recent deliveries, payouts), R12 report an issue on a job and an Emergency button (location, critical alert to every dispatcher)
- [x] R13 profile with an emergency contact (encrypted); Emergency and accident reports text that contact the rider's location (RID-14)
- [ ] Background location (foreground service), offer alarm, batch run (R09), offline queue

## Milestone 6: Card payments and launch

- [ ] Card/online payments through iPay (hosted page, server callback with checksum verification) behind the payment adapter. Required before go-live.
- [ ] Launch gates from PRD section 17 (pen test, DPIA, reconciliation for all three methods, load test, store listings, and the rest)

## Later

- Web dispatch console
- PRD "C" items: promo codes (CUS-21), Bluetooth printing (RES-14), multi-branch (RES-15), Sinhala and Tamil
