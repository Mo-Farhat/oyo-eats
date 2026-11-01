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
- [ ] C09 full tracking over Socket.IO, C11 live delivery map (needs rider location from Milestone 5 to be meaningful)
- [x] C12 delivered and rating (editable 24 h), reviews on restaurant pages (CUS-20)
- [x] C13 history: reorder, receipt PDF
- [ ] C14 cancel by request after acceptance (support case), C19 report a problem with photos
- [x] C15 profile: name, verified phone change, notification settings, delete account (PRI-06)
- [ ] Push notifications for customer events (section 10)

## Milestone 3: Restaurant (T01–T12)

- [x] API: board (tenant-scoped under RLS), accept with prep time, reject with reason (and mark items sold out), mark ready, running-late delay, Open switch (pause until reopened); customer sees the promised ready time
- [x] T01 board (New / Preparing / Ready / Done, kept awake), T02 full-screen new-order alarm with looping sound (foreground), T03 accept, T04 reject sheet, T05 preparing (countdown, checklist, delay, mark ready), T06 handover number
- [ ] Alarm with the screen locked and the app in the background (Notifee, needs a development build)
- [ ] Mark an item unavailable mid-order, with the customer substitution or partial refund flow (RES-05)
- [ ] T07–T09 menu management with approval requests (RES-08, RES-09), menu photos
- [ ] T10 hours: weekly schedule, holiday overrides, timed pause (RES-10)
- [ ] T11 payouts and T12 more: statements, staff (RES-01), reviews with replies (RES-12), history and daily sales (RES-13)
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
- [ ] A15 menu approvals, A18 customers, daily reconciliation job, refunds paid out through the ledger, rider deductions and adjustments
- [ ] A19 reports, A20 settings, A21 staff and more, A22 cancel and refund with caps, audit log screen, broadcast
- [ ] Unassigned alert to every dispatcher on shift; realtime board over Socket.IO

## Milestone 5: Rider (R01–R13)

- [x] API: online/offline (blocked mid-job), location reports with mock flag, current offer (area only), accept, decline with reason, expiry with the three-miss rule, pickup (needs ready), deliver with COD cash and variance reason, cash held
- [x] Screens: R01/R02 offline and online, R03 offer with 60 s countdown and ring, R04 decline reasons, R05–R08 to restaurant, pickup, to customer, complete (swipe-only status changes, COD cash entry); R11 cash on hand (first pass); foreground location reports
- [ ] Background location (foreground service), offer alarm, batch run (R09), earnings (R10), cash (R11), report an issue (R12), emergency, profile (R13), offline queue

## Milestone 6: Card payments and launch

- [ ] Card/online payments through iPay (hosted page, server callback with checksum verification) behind the payment adapter. Required before go-live.
- [ ] Launch gates from PRD section 17 (pen test, DPIA, reconciliation for all three methods, load test, store listings, and the rest)

## Later

- Web dispatch console
- PRD "C" items: promo codes (CUS-21), Bluetooth printing (RES-14), multi-branch (RES-15), Sinhala and Tamil
