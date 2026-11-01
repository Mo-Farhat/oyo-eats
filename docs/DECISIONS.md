# Decisions

Decisions made while planning, with the reason for each. Newest changes at the top of each section. The PRD stays the source of truth for *what* we build. This file records *how*, and any scope order that differs from the PRD.

## Scope and order (2026-11-01)

| Decision | Detail |
| --- | --- |
| Fresh build | The old `~/Projects/delivery-app` (Flutter + Firebase) is not reused, neither its code nor its design. |
| Admin stays on the phone | Admin/dispatch is a face inside the one mobile app, as in the design canvas (A01–A22). A web dispatch console comes later on the same API. |
| Payments: COD and bank transfer first | Cash on delivery and bank transfer with slip upload plus admin verification are built first. Card/online payment (iPay, hosted page and server callback) is required before go-live but is built last, once everything else works, behind a payment-provider adapter so it plugs in without touching order logic. |
| Restaurants on Android tablets | iOS cannot do a full-screen takeover on a locked screen (RES-02), and the Critical Alerts entitlement is unlikely for food orders. Restaurants are told to use Android tablets; on iOS the restaurant face uses a time-sensitive push with a long sound and keeps the screen awake while open. |
| Keep it simple | No infrastructure until a real need shows up. One API instance, timers in the same process, no Redis. |
| Pilot town: Nawalapitiya (2026-11-01) | The launch zone (PRD section 18, decision 10). Demo data is set there. The design canvas is placeholder content; where it disagrees with the PRD, the PRD wins. |
| Build order | Foundation, then customer, then restaurant, then dispatch, then rider. See [ROADMAP.md](ROADMAP.md). |

## Stack (2026-11-01)

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere | Fee calculation, the order state machine, money helpers and validation schemas live in one shared package, so the fee shown always equals the fee charged (NFR-14, SEC-23). |
| Repo | npm workspaces + Turborepo | No extra global tooling (pnpm isn't installed). Expo supports npm monorepos without extra config. |
| Mobile | Expo (React Native) with development builds, Expo Router, TanStack Query, Zustand | One app, four faces. Dev builds give native access for the rider's background location (`expo-location` + TaskManager), the restaurant's full-screen order alarm (Notifee), and the secure store (`expo-secure-store`). EAS Update covers staged rollout. |
| API | NestJS | Role and object-level guards fit deny-by-default RBAC (SEC-09/10). Its modules map onto the PRD's services. |
| Database | PostgreSQL + PostGIS, Drizzle ORM | Relational data for the double-entry ledger, append-only order events, row-level security (SEC-11), and geo queries (10 km radius, rider distance sort). |
| Jobs and timers | pg-boss (runs on Postgres) | Restaurant auto-reject (5 min), slip window (30 min), offer expiry (60 s), and unassigned alerts, with no extra infrastructure. |
| Locks | Postgres row locks / advisory locks | The dispatcher's 30 s soft lock (ADM rule) and idempotency keys (SEC-22). |
| Realtime | Socket.IO from the API; push as a fallback | Board and status updates under 2 s (NFR-03). A single API instance is enough at launch scale (5,000 orders/day). |
| Auth | Built in-house | Phone OTP with hashed codes (SEC-01), Argon2id passwords (SEC-02), TOTP 2FA (SEC-03), 15 min access tokens with rotating refresh tokens and reuse detection (SEC-04), device binding (SEC-06). Off-the-shelf auth doesn't fit these rules. |
| File storage | S3-compatible private bucket with signed URLs | Bank slips, rider documents, menu photos (SEC-17). |
| Maps | Google Maps SDK in the app, Google Routes API on the server | One provider for both distance and ETA (NFR-14). |
| Push | FCM / APNs via Expo notifications | High-priority data messages for the critical alerts. |
| SMS | Local gateway (Notify.lk, Text.lk or Dialog), plus a fallback provider | OTP and SMS fallback (NOT-04). Provider still to be picked. |
| Tests | Vitest | Every rule in PRD sections 8 and 9 gets unit tests (section 17). |

### Hosting (2026-11-01)

| Piece | Choice | Notes |
| --- | --- | --- |
| API | Render web service, Singapore | One instance; Socket.IO and pg-boss run in the same process. Zero-downtime deploys and rollback come with Render. |
| Database | Neon Postgres + PostGIS, AWS Singapore | Same region as the API. Scale-to-zero off in production. Dev uses a Neon branch. pg-boss, advisory locks and migrations use the **direct** connection string, not the pooled one (the pooler breaks session locks). |
| Files | Cloudflare R2 | S3-compatible, private bucket, signed URLs, no egress fees. Local disk in dev. |
| DNS / TLS | Cloudflare | |
| Mobile builds | EAS Build, Submit and Update | |

Cloudflare Workers were considered for the API and rejected: NestJS, long-lived Socket.IO connections and the pg-boss worker all need a long-running process. The Singapore region is provisional until the lawyer confirms the PDPA transfer basis (open decision 5).

If we ever run two API instances, add Render Key Value (Redis) for the Socket.IO adapter. Not before.

### Database access and RLS (2026-11-01)

- The API connects as the Neon owner role (needed for migrations and pg-boss) but runs every request with `SET LOCAL ROLE oyo_app`, a NOLOGIN role without BYPASSRLS. One connection string, no second login.
- Scope per transaction: `platform` (customers, riders, dispatchers, owner, system jobs) sees all tenants, and the API does the object-level checks (SEC-10); `tenant` (restaurant users) sees only its own restaurant's rows. No scope sees nothing.
- Platform-only tables (riders, ledger, audit log, settings, addresses, offers, cash) are invisible in tenant scope. When a restaurant screen needs rider details (RES-06), the API reads them in platform scope after its own check.
- Append-only and balance rules are enforced in the database by triggers, not only in code.
- Down migrations are not written; NFR-13 reversibility is handled by forward fixes plus Neon point-in-time restore and branches. Revisit before launch.

### Auth (2026-11-01)

- Opaque access and refresh tokens (random, stored hashed), not JWTs. Every request looks up its session, which makes revocation immediate (section 2: deactivation revokes all sessions) without a denylist. Access 15 min; refresh 30 days, except dispatcher and owner at 30 min idle (SEC-08).
- Refresh rotates; a reused refresh token revokes the whole token family (SEC-04). Password change and TOTP enrolment sign out every session and return new tokens.
- Customer sign-up happens at the first OTP verification and requires `acceptTerms` (privacy notice, terms, 18+). The display name is set later in the profile.
- Device binding (riders and restaurant users): the first device binds itself; later devices wait for admin approval. The approval endpoint comes with the admin face (Milestone 4).
- Breached-password check uses the Have I Been Pwned range API (only a 5-character hash prefix leaves the server) and fails open if it's down. Logged so we can see it.
- Login lockout: 5 failures lock for 15 min, doubling per further failure, capped at 24 h. TOTP failures count too. Each failure and lock is in the audit log; alerting on them comes with monitoring.
- Per-IP rate limiting on `/auth/*` uses the in-memory Nest throttler (20/min). Fine for one instance; it needs a shared store if we ever run two.

### Access, idempotency, jobs, seed (2026-11-01)

- Every API route declares its access rule; undeclared routes are refused at runtime and fail a test. Role permissions come from `roles.ts`; ownership checks from `access.ts`, both in `@oyo/shared`.
- Idempotency keys are stored per account for 24 h. The key is released if the handler fails, so money handlers must fail before they commit anything.
- pg-boss runs inside the API process (one instance), in its own `pgboss` schema. An hourly maintenance job purges expired idempotency keys, old OTP challenges and dead sessions.
- The seed writes only the settings the PRD fixes (fee, rider caps, timers). COD limit, minimum order, dispatcher refund cap and bank details wait for the business (PRD section 18, decision 6). Demo restaurants and one demo account per face are created outside production; they double as the App Store and Play review accounts later.

### Bank transfer (2026-11-01)

- The 30-minute slip window is the upload deadline. If a slip was uploaded in time but nobody has reviewed it when the window ends, the order is not cancelled (the customer has paid); the check repeats every 10 minutes until the office decides. Escalation to dispatchers comes with the board (A01).
- Slips are images only (JPG, PNG, WebP, HEIF), re-encoded to JPEG, which drops EXIF/GPS and anything hidden in the file (SEC-17, SEC-25). The SHA-256 of the original upload, and the optional bank reference, must be unique across orders (SEC-24). PDF slips are not accepted yet.
- Bank transfer is only offered once `bankDetails` is set. Approval confirms the payment and starts the restaurant's 5-minute timer.
- A customer can cancel before the restaurant accepts even after paying by transfer; that opens a `refund_bank_transfer` support case for the office, since a transfer can't be refunded automatically.
- Ledger postings for confirmed payments come with the money slice (settlements, Milestone 4).

### Customer account (2026-11-01)

- Ratings: restaurant (stars, fixed tags, comment) and rider (stars, tags), editable until 24 h after delivery. Reviews show the first name only.
- The design's "Order notifications" toggle is "Offers and news": order updates are transactional and can't be muted (NOT-03). Opt-in defaults to off.
- Phone change sends a code to the new number and switches only after it is verified.
- Account deletion is immediate (inside PRI-06's 30 days): name, phone, saved and delivery addresses, item notes and review comments are removed; delivery pins are blurred to ~1 km; star ratings and order amounts stay, anonymised. Blocked while an order is open.

### Infrastructure constraint

**No Docker for local dev.** The user finds the setup too heavy. That's why the backend needs only Postgres: no Redis, BullMQ or MinIO. If we later scale to several API instances, add Redis for the Socket.IO adapter. That's the one planned point where infrastructure grows.

Local Postgres options, still to be picked (see open decisions):
- a hosted dev database (Neon or Supabase used as plain Postgres; both support PostGIS)
- the system Postgres (the psql 14 client is installed; is the server?)

## Domain rules fixed in code

These come from the PRD and get encoded in `packages/shared`:

- Money is integer cents (LKR minor units), never floats. The ledger is double-entry and append-only; corrections are reversing entries.
- Delivery fee = base 150 LKR + 55 LKR per km on the road route, pro rata for part kilometres, rounded to a whole rupee. Base, per-km rate and radius come from settings (ADM-18), never constants. Check: 2.0 km = 260, 3.6 km = 348, 6 km = 480.
- Prices and fees lock when the order is placed. The server always recomputes totals.
- An order runs on two tracks. Kitchen: awaiting restaurant, preparing, ready. Delivery: unassigned, offered, assigned. They meet at pickup, which needs both *ready* and *assigned*.
- A bank-transfer order is held from the kitchen until the slip is approved (PRD section 18, decision 1 default).
- Every status change is an order event with actor, device and time. The timeline is rebuilt from events and never edited.
- Timestamps are stored in UTC and shown in Asia/Colombo.

## Design system

Taken from the design canvas (`project/ds/oyo-eats/tokens.json`):
- Dark theme only. Page `#18191b`, card `#191c21`, bar `#111113`, card border `#212830`.
- Brand green `#648402`, with white text on it (bold, 18px+). Orange `#f97316` appears only in the "Eats" of the wordmark.
- Text: strong `#ffffff`, body `#d1d5dc`, muted `#99a1af`.
- Type: Poppins for display and headings, Open Sans for body.
- Radii: button 8, tile 12, stat 16, card 24, pill 9999.
- Screens are designed at 390×844.

## Decided 2026-11-02

- **Rider pay** (PRD section 18, #4): the order's delivery fee less 10% (setting `riderPay.platformShareBps = 1000`), rounded to the rupee, fixed on the offer.
- **Office line**: 072 878 7872. Customers see the assigned rider's phone from acceptance until the order closes (`canSeeRiderContact`).
- **Business bank account** for bank transfers: Commercial Bank, Nawalapitiya, "Oyo Eats", 1000857557.

## Open decisions

| # | Decision | Default until decided |
| --- | --- | --- |
| 2 | SMS provider for OTP | Use a console/log stub in dev |
| 5 | Cloud region (PDPA, PRD section 18, #7) | Decide with the lawyer before production |
| 6 | Order exit states | `rejected` (restaurant rejected or timed out), `cancelled` (customer, admin, or slip expired), `failed` (delivery failed / no-show). Confirm against the lifecycle diagram, which didn't export with the PRD. |
