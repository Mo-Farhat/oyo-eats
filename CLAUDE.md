# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Oyo Eats

Food delivery for Sri Lanka: one Expo mobile app with four role-based faces (customer, rider, restaurant, admin/dispatch) on a single NestJS API.

Read these before starting work:

- `docs/PRD-v1.md`: requirements. Requirement IDs (CUS-xx, RID-xx, RES-xx, ADM-xx, SEC-xx) are the shared vocabulary.
- `docs/DECISIONS.md`: stack, scope order, domain rules, design tokens, open decisions (with the default to use until each is decided).
- `docs/ROADMAP.md`: milestones. Tick boxes as work lands.
- Design canvas: https://claude.ai/code/artifact/bcb0cd8a-5a29-4087-90ba-99b2d43e43fc. Read screen files with the Artifact tool's `read` action (e.g. `project/C02-Home.dc.html`, `project/oyo-app.css`, `project/ds/oyo-eats/tokens.json`). Screen IDs match the PRD: S, C, R, T, A.

## Status

A full delivery now runs in the app across all four faces: customer orders (Milestone 2), kitchen accepts and marks ready (Milestone 3: T01–T06), dispatch assigns (Milestone 4: A01, A03, A06), rider accepts, picks up and delivers (Milestone 5: R01–R08). The owner onboards restaurants (add, hours, menu, logins, go live) and admins issue logins and approve devices (`src/admin` in the API, the Restaurants and People tabs). Many supporting screens are still placeholders; see the checklists in `docs/ROADMAP.md`. Things waiting on the user are in `docs/NEEDS-YOU.md`; add to it rather than stopping.

## Commands

Run from the repo root (Turborepo runs each workspace's script; `^build` builds `packages/shared` first):

```
npm install
npm run dev          # shared in watch mode, API (nest start --watch), Expo dev server
npm run build | lint | typecheck | test
npm run format       # prettier --write .
npm run dev -w @oyo/api                              # one workspace only
npm test -w @oyo/shared -- src/fees.test.ts          # one test file
npm test -w @oyo/shared -- -t "6000 m costs"         # tests matching a name
npm run db:generate -w @oyo/api                      # SQL migration from src/db/schema.ts changes
npm run db:migrate -w @oyo/api                       # apply migrations to DATABASE_URL
npm run db:seed -w @oyo/api                          # settings, owner, demo data (re-runnable)
npm run demo:setup -w @oyo/api                       # rehearsal logins in apps/api/.demo/ (dev only)
npm run demo:simulate -w @oyo/api -- --you kitchen   # orders + autopilot for the other roles (docs/REHEARSAL.md)
```

- Mobile (`apps/mobile`):
  - Add native packages with `npx expo install <pkg>` from `apps/mobile` (picks SDK-compatible versions). `apps/mobile/AGENTS.md` has Expo's own guidance: check the versioned docs for the installed SDK, never write `ios/`/`android/` by hand.
  - Routes live in `src/app`. The root `_layout.tsx` uses `Stack.Protected` to expose exactly one group: `(auth)` signed out, `(setup)` while password change or 2FA enrolment is pending, else the role's face (`(customer)`, `(rider)`, `(restaurant)`, `(admin)`). Route names are unique across groups; `src/app/index.tsx` redirects to the right one, so screens just `router.replace('/')` after any sign-in change.
  - Build screens from `src/components` and `src/theme/tokens.ts` (colours, fonts, type styles from the design canvas). React Native picks font weight by family name, so use the `fonts`/`type` tokens, not `fontWeight`.
  - Call the API through `authApi`/`api` in `src/api` (refreshes once on 401, sends the device id) inside TanStack Query; show errors with `errorMessage()` from `src/api/messages.ts`. Session state is the `useSession` Zustand store, persisted in the secure store.
  - Response types come from `@oyo/shared` (`api-types.ts`), so API and app agree.
  - Check a change compiles for both platforms without a device: `CI=1 npx expo export --platform android --platform ios --output-dir /tmp/x`.
  - Web preview (`npx expo start --web`) works against a local API (CORS is on in development only). It's for development checks; the shipped targets are iOS and Android. Don't start it with `CI=1`: that turns off Metro's file watching and the page keeps serving the old bundle.
  - Customer state that must survive restarts (cart, chosen address, recent searches) is the persisted `useCustomer` store (`src/customer/store.ts`, AsyncStorage). Prices shown before checkout come from the server quote (`useQuote`), not local maths.
  - Rider status changes use `SwipeButton` (swipe-only, section 5). Faces that must stay on through a shift call `useKeepAwake()`. Offers and new-order alarms are full-screen modals over the tab layout, with the looping sound from `assets/sounds`.
  - Horizontal `ScrollView`s inside a vertical one need a fixed-height wrapper, or they stretch on web.
- API env: copy `apps/api/.env.example` to `apps/api/.env` and fill `DATABASE_URL`, `HASH_KEY`, `ENCRYPTION_KEY` (generation command in the file). `main.ts` loads it with `process.loadEnvFile()`; `src/config.ts` fails fast on anything missing.
- `packages/shared` is consumed as built output (`dist/`), so the API and app see changes only after a build (or while `npm run dev` is watching).
- Everything is ESM (NestJS 12 is ESM-only): relative imports in `api` and `shared` need the `.js` extension.
- `order-state.test.ts` checks every reachable state x event x actor against a hand-written `EXPECTED` table. When you change a transition rule, update that table too; don't loosen the exhaustive loop.
- Database (`apps/api/src/db`, `apps/api/drizzle`):
  - Request code must run inside `withScope(db, scope, tx => ...)`. It switches to the restricted `oyo_app` role and sets the scope RLS reads (`platform`, or `tenant` with the restaurant id). The Neon owner role has BYPASSRLS, so queries outside `withScope` skip RLS entirely.
  - Every table has RLS on. A new table needs a policy (and `tenant_id` if restaurant-owned) in a custom migration (`npx drizzle-kit generate --custom --name <name>`), like `drizzle/0001_rls_and_guards.sql`.
  - `order_events`, `ledger_*` and `audit_log` reject UPDATE/DELETE by trigger. Ledger entries per transaction must sum to zero, checked at commit. Paid settlements are frozen.
  - Drizzle drops the SRID from `geometry` columns; after `db:generate`, change `geometry(point)` to `geometry(Point, 4326)` in the generated SQL before migrating.
  - `src/db/guards.test.ts` runs against the real `DATABASE_URL` inside rolled-back transactions (skipped when unset).
  - `DATABASE_URL` uses `sslmode=verify-full`. psql 14 can't verify without a root cert file, so for ad-hoc psql swap in `sslmode=require`.
- Auth (`apps/api/src/auth`):
  - Every route must declare one access rule from `auth/decorators.ts`: `@Public()`, `@SignedIn()`, `@RequirePermission(...)` (permissions from `roles.ts` in `@oyo/shared`) or `@AllowLimited()`. The global `AuthGuard` refuses undeclared routes, and `access.e2e.test.ts` fails if any controller route lacks one. Get the caller with `@CurrentAuth()`.
  - Role permissions are not ownership. Services must also check the record: `canViewOrder` / `canSeeCustomerContact` in `@oyo/shared` (`access.ts`), and run queries in `withScope(db, scopeFor(auth), ...)` so restaurant users get tenant RLS.
  - Tokens are opaque random strings stored as SHA-256 hashes in `sessions`, looked up on every request, so deactivation and sign-out take effect immediately.
  - `AuthService` takes its dependencies as plain constructor arguments (wired with `useFactory` in `auth.module.ts`) so tests can build it with a rolled-back transaction, fake SMS and a fake clock. Follow the same pattern for new services.
  - Failures are `AuthError` codes (`errors.ts`), sent as `{ error, ...details }`. When a transaction must commit bookkeeping (attempt counters, revocations) and still fail, return an `Outcome` and `unwrap` it after commit.
  - SMS is `ConsoleSmsSender`, which prints codes and refuses to start in production.
- Validate request bodies with `new ZodPipe(schemaFromShared)`; route ids with `UuidPipe`.
- Order state changes only through `applyOrderEvent()` (`orders/order-events.ts`): it locks the row, runs the shared state machine and writes the event. Timers are pg-boss queues registered with `JobQueue.define()` (inject `JOBS`); tests get a `RecordingJobQueue` and run jobs with `runAll()`.
- Files (slips, documents, photos) go through the `STORAGE` provider (`storage/storage.ts`): private keys, short-lived signed URLs, local disk in development. Uploaded images are re-encoded with `sharp` before storing. Tests get `MemoryStorage` from the harness, which also has `upload()` (multipart) and `staff(role)` (a fully signed-in staff token).
- Restaurant endpoints read order data in `withScope(db, scopeFor(auth))` (tenant RLS proves ownership), then read customer first names, rider details and settings in platform scope for those orders only. Restaurants never get customer phone or address.
- Provider adapters switch on from env vars (`config.ts`): `R2Storage`, `NotifyLkSender`, `GoogleRouting`; otherwise local disk, console SMS, straight-line distance. Production refuses to start without R2, SMS and `PUBLIC_URL`. Deployment is `render.yaml`; account setup steps are in `docs/SETUP-PROVIDERS.md`.
- Road distance comes from the `ROUTING` provider (straight line x 1.3 until Google Routes); never compute fees from client distances.
- HTTP tests use `withHarness()` and `fixtureRestaurant()` from `src/testing/harness.ts` (captured SMS, recorded jobs, always-open restaurant far from the seed data).
- Money movements post to the ledger with `post()` helpers in `src/ledger/ledger.ts`, inside the same transaction as the event that causes them (positive = debit). Settlements read orders and `settlement_lines`; each order is settled once per party.
- Money-moving endpoints get `@Idempotent()` (`common/idempotency.ts`): it requires an `Idempotency-Key` header, replays retries, and releases the key if the handler throws. So a handler must not commit a money movement and then throw.
- Live updates: triggers on `order_events` and `menu_change_requests` send `pg_notify('oyo_live', ids only)` on commit (`drizzle/0012_live_notify.sql`). `LiveListener` (one LISTEN connection, direct Neon host) feeds `LiveGateway` (Socket.IO `/live`, token in the handshake, rooms from `live/rooms.ts`) and `LiveBus`. The app's `LiveUpdates` refetches query keys on `changed`; add new keys to `keysFor()` when a screen should update live.
- Notifications: `order_events` is the outbox. `NotificationsService` claims events via `notification_runs` (ON CONFLICT DO NOTHING; `order_events` can't be row-locked), writes one `notifications` row per person from `orderNotifications()` in `@oyo/shared`, then pushes pending rows (Expo when `config.expoPush`, else logged). Tests call `runOnce()` and pass `{ push }` to `withHarness`.
- Background work goes through pg-boss in `jobs/jobs.module.ts` (`QUEUES`, workers, schedules). Tests build the app with `jobs: false`.
- HTTP tests: `AppModule.forRoot(testConfig(), { db: tx, jobs: false, imports: [...] })` inside `inRollback` (see `access.e2e.test.ts`). Requests share the one transaction, so send them one at a time.
- Tests share the dev database with seeded demo data: filter assertions to your own fixtures rather than counting whole tables.
- API integration tests are slow from here (every round trip goes to Neon in Singapore); `vitest.config.ts` allows 30 s per test.
- TypeScript is pinned to `~6.0` to match Expo SDK 58 and typescript-eslint; don't bump it to 7 independently.

## Planned layout

```
apps/mobile/      Expo (Expo Router, one route group per face, chosen by role after login)
apps/api/         NestJS, Drizzle on Postgres + PostGIS, pg-boss for timers, Socket.IO for realtime
packages/shared/  Domain logic imported by both: money, fees, order state machine, roles, Zod schemas
```

## Architecture to keep in mind

- `packages/shared` is the single source for anything the app shows and the API charges (fees, totals, transitions, validation). The app may compute a preview; the API recomputes and its number wins.
- Orders run on two tracks (kitchen: awaiting restaurant → preparing → ready; delivery: unassigned → offered → assigned) that join at pickup, which needs both _ready_ and _assigned_. Exit states are `rejected`, `cancelled`, `failed`. Bank-transfer orders are held from the kitchen until the slip is approved.
- Every status change is an append-only order event (actor, device, time); the timeline is rebuilt from events. The ledger is double-entry and append-only; corrections are reversing entries.
- Everything that needs infrastructure runs on Postgres: timers via pg-boss (auto-reject, slip window, offer expiry), the dispatcher soft lock and idempotency keys via row/advisory locks. Don't add Redis or a queue service.
- Fee parameters (base, per-km, radius) and timer durations come from settings (ADM-18), never constants.
- Auth is in-house (phone OTP for customers, Argon2id + TOTP for staff, rotating refresh tokens with reuse detection). RBAC is deny by default with role and object-level guards; tenant-owned rows carry a tenant id and RLS.
- Timestamps are stored in UTC and shown in Asia/Colombo.
- UI is dark theme only, designed at 390×844; take colors, fonts and radii from the design tokens, not ad-hoc values.

## Working rules

- No Docker. Keep local setup to Node plus a Postgres connection string.
- npm workspaces (with Turborepo), not pnpm.
- Don't reuse code or design from `~/Projects/delivery-app`.
- Money is integer cents only. The server recomputes every total and fee. Never trust client numbers.
- Domain rules (fees, the order state machine, refund rules) live in `packages/shared` and are covered by tests. The fee engine must pass the PRD checks: 2.0 km = 260, 3.6 km = 348, 6 km = 480 LKR.
- Card payments are deferred. Build COD and bank transfer first, and keep payments behind an adapter.
- Commit only when asked.
