# Oyo Eats — Product Requirements Document (PRD) v1

Oct 30, 2026 · @Farhat

## 1. Product summary

Oyo Eats is a single multi-tenant mobile app, with four role-based faces, that lets a delivery business run the whole food-delivery chain itself: customers order from partner restaurants, admins manually assign riders, restaurants prepare, and riders deliver. This PRD defines the full production product, not an MVP, and sits beside the Spec v1 and the Design canvas (67 screens).

**Problem.** Restaurants in Sri Lanka either run their own thin delivery or depend on platforms that take large commissions and hide the rider. The delivery business here owns the rider fleet and the customer relationship, and needs one system that gives dispatchers full control, keeps cash and bank transfers reconcilable, and protects customer, rider and restaurant data.

**Vision.** Every order from tap to settlement is visible, assignable, auditable and secure, with a dispatcher always able to override the system.

### Goals

1. Deliver an order end to end with a human dispatcher assigning every rider, and a rider who must accept each job.
2. Support COD, bank transfer (slip verified by admin) and card/online payments in LKR.
3. Settle money accurately: restaurant payouts, rider payouts, cash on hand, refunds, all reconcilable to the cent.
4. Isolate data by role and tenant so no face can see what it should not.
5. Run reliably at peak meal hours with live tracking and instant order alerts.

### Non-goals (v1)

- Automatic or algorithmic rider assignment (manual by design; suggestions only, see section 8).
- Multiple roles per account; one account has one role.
- Customer-to-customer features, scheduled group orders, loyalty or subscriptions for customers.
- Countries or currencies beyond Sri Lanka and LKR; languages beyond English at launch (Sinhala and Tamil are planned localisation targets, section 13).

### Success metrics

| Metric | Target at 90 days live |
| --- | --- |
| Order accept to rider assigned (median) | under 3 min |
| Order placed to delivered (median) | under 40 min |
| Orders delivered without support contact | 95% or higher |
| Cash discrepancy per rider handover | under 0.5% of cash collected |
| Bank slip verified within window | 90% or higher in 30 min |
| App crash-free sessions | 99.5% or higher |
| Order alert delivered to restaurant | under 5 s, 99% |

## 2. Users, roles and permissions

There are five roles in one app. An account holds exactly one role, and the app opens the matching face after login. Customers sign up with phone OTP; every other role is created by an admin and signs in with a username and password issued by the business.

| Role | Who | How the account is made | Sign-in | Can see | Cannot do |
| --- | --- | --- | --- | --- | --- |
| Customer | Public eater | Self sign-up | Phone OTP | Own profile, orders, addresses, ratings | See other customers, riders' contact before assignment, internal notes |
| Rider | Employed or contracted courier | Admin creates | Username + password, forced reset on first login | Own offers, active jobs, earnings, cash held | Accept without being offered, see other riders' earnings, change fees |
| Restaurant staff | Kitchen or counter user | Restaurant owner or admin creates | Username + password | Own restaurant's orders, menu, hours, payouts | See other restaurants, customer phone before handover, assign riders |
| Restaurant owner | Business owner of a restaurant | Admin creates | Username + password + 2FA | Everything staff see plus payouts, staff, bank details | See other restaurants |
| Dispatcher | Admin staff on the board | Owner creates | Username + password + 2FA | Orders, riders, live map, bank slips, cash handovers, customers | Settings, payouts, refunds above the cap, staff management, reports |
| Owner (super admin) | The delivery business | Seeded at install | Username + password + 2FA | Everything, including settings and audit log | Delete audit records |

### Permission principles

- Role-based access control is enforced on the server for every API call; hiding a button in the app is never the control.
- Every record is scoped: a restaurant user queries only their restaurant's data, a rider only their own jobs, a customer only their own orders.
- Sensitive fields are revealed just in time. A rider sees the customer's phone and exact address only after accepting; a restaurant sees the customer's first name and order only until handover.
- Admin actions that change money (refund, payout, cash write-off, fee change) are owner-only or capped for dispatchers, and always written to the audit log with who, when, from where, and the before and after values.
- Deactivating an account revokes all sessions and tokens immediately.

## 3. Scope and release plan

This is the full product, not an MVP: every requirement marked M or S in sections 4 to 7 ships at launch. The release plan changes the build order and the rollout, never the scope.

&#91;embedded content: release roadmap · 5 phases, 3 gates\]

The business goes live when the three gates pass. Gate 2 is the long one: it holds every item in the launch checklist in section 17, including the penetration test and payment reconciliation.

### What is in and out

- **In at launch:** all four faces, the three payment methods, manual dispatch with batching, live tracking, the rider-assigned pop-up, settlements and payouts, support cases, reports, the audit log, and every control in sections 11 and 12.
- **After launch (marked C):** promo codes and credits (CUS-21), Bluetooth ticket printing (RES-14), multi-branch restaurants (RES-15), and Sinhala and Tamil (section 13).
- **Out of scope:** automatic assignment, multi-role accounts, countries beyond Sri Lanka, loyalty and subscriptions for customers.

## 4. Customer app requirements

Screens C01 to C15 plus login S02 to S05 are specified in the Design canvas. Priority: **M** = required for launch, **S** = should have at launch, **C** = can follow in a later release.

| ID | Requirement | Pri |
| --- | --- | --- |
| CUS-01 | Sign up and sign in with a Sri Lankan mobile number and 6-digit OTP; OTP expires in 5 min, 5 attempts, resend after 30 s | M |
| CUS-02 | Set delivery location by map pin, GPS, or typed address; save labelled addresses (Home, Work) with a delivery note | M |
| CUS-03 | Home lists restaurants open now and deliverable to the pinned location (within the 10 km radius), with search, cuisine filters, ratings and ETA | M |
| CUS-04 | Restaurant page shows menu by category, item photos, prices in LKR, dietary tags, sold-out items greyed out | M |
| CUS-05 | Item sheet with required and optional modifiers, quantity, and a special-instructions field | M |
| CUS-06 | Cart is single-restaurant; adding from another restaurant prompts to replace the cart; cart survives app restart | M |
| CUS-07 | Checkout shows item total, delivery fee (150 + 55 per km, calculated on the road route), any restaurant fee, and grand total before payment | M |
| CUS-08 | Pay by cash on delivery, bank transfer, or card/online; COD is hidden when the order exceeds the COD limit or the customer is flagged | M |
| CUS-09 | Bank transfer: show business account details and order reference, customer uploads a slip photo, order waits for admin verification within the slip window (30 min default) | M |
| CUS-10 | Card/online payment through a PCI-compliant hosted payment page with 3-D Secure; the app never sees or stores card numbers | M |
| CUS-11 | Order tracking with status timeline: placed, confirmed, preparing, ready, rider assigned, picked up, on the way, delivered | M |
| CUS-12 | When a rider is assigned, send a push and show an on-screen pop-up with rider name, photo, vehicle, plate, rating and a call button; the pop-up stays until dismissed and the details remain on the order | M |
| CUS-13 | Live map of the rider's position once picked up, with ETA that updates at least every 15 s | M |
| CUS-14 | Customer can cancel freely until the restaurant accepts; after that cancellation is by request to support, with refund rules in section 9 | M |
| CUS-15 | Call or message the rider through masked numbers; the rider never sees the customer's real number outside the active order | S |
| CUS-16 | Delivered screen asks for a rating of the food and the rider, with tags and a free-text review; ratings can be edited for 24 h | M |
| CUS-17 | Order history with reorder, receipt, and status; receipts downloadable as PDF | M |
| CUS-18 | Profile: name, phone (verified change only), saved addresses, notification settings, language, delete account | M |
| CUS-19 | Report a problem on an order (missing item, wrong item, cold food, late, rider issue) with photos; creates a support case in the admin console | M |
| CUS-20 | Reviews on restaurant pages show only verified delivered orders | S |
| CUS-21 | Promo codes and credits applied at checkout, with usage limits and expiry | C |

### Key rules

- The order price and delivery fee are locked at placement; later menu or fee changes do not alter an open order.
- If the restaurant rejects or times out, the customer is notified at once and any online payment is refunded automatically.
- A customer can have at most 3 open orders and 2 unpaid bank-transfer orders at once.
- Delete account removes personal data per section 12 but keeps anonymised financial records.

## 5. Rider app requirements

Screens R01 to R13. The rider app is built for one-handed use outdoors: large targets, high contrast, and swipe-only confirmation for every status change so a stray tap cannot advance a job.

| ID | Requirement | Pri |  |
| --- | --- | --- | --- |
| RID-01 | Sign in with admin-issued credentials; first login forces a new password; device is bound after first login and a new device needs admin approval | M |  |
| RID-02 | Online/offline toggle; going online starts location sharing, going offline stops it and is blocked while a job is active | M |  |
| RID-03 | Job offer screen with pickup restaurant, drop-off area (street and distance, not the full address), payout, item count, and a 60 s countdown; accept or decline | M |  |
| RID-04 | An offer expires on timeout, counts as a miss, and returns to the dispatcher; 3 consecutive misses auto-set the rider offline and alert the dispatcher | M |  |
| RID-05 | After accepting: navigate to the restaurant with the in-app map and a deep link to Google Maps or Waze; restaurant contact is shown | M |  |
| RID-06 | Pickup flow: arrive, verify order number and item count against the ticket, then swipe to confirm pickup; flag a problem if items are missing | M |  |
| RID-07 | Drop-off flow: full customer address, masked call button, delivery note, and swipe to confirm arrival then delivery | M |  |
| RID-08 | Complete delivery: for COD enter the cash collected and confirm the amount; mismatch above a threshold requires a reason; for prepaid orders, confirm handover only | M |  |
| RID-09 | Batch run: when the admin batches orders, show an ordered stop list (pick-ups then drop-offs) with one status per stop and a combined payout | M |  |
| RID-10 | Foreground service keeps location updates every 5 s while on a job and every 30 s while online and idle; battery-saver aware | M |  |
| RID-11 | Earnings: today, this week, per-delivery breakdown, tips, adjustments, pending and paid | M |  |
| RID-12 | Cash on hand: running total of COD cash held, cap alert at the configured limit (15,000 LKR), handover history with receipts | M |  |
| RID-13 | Report an issue (customer unreachable, restaurant closed, accident, vehicle problem, wrong address) which alerts the dispatcher live and pauses the delivery timer | M |  |
| RID-14 | Emergency button sends the rider's live location to the dispatcher and a stored emergency contact | S |  |
| RID-15 | Profile: documents, vehicle, plate, rating, shift history, support contact | M |  |
| RID-16 | Offline tolerance: status changes queue locally and sync when connection returns; the job screen never loses the active order | M |  |

### Key rules

- A rider can hold at most 3 active orders (configurable) and only batches the admin has created.
- A job the rider declines is never re-offered to the same rider unless the dispatcher chooses so manually.
- Customer phone and full address are removed from the rider's device when the order closes.
- Pay per delivery is fixed at assignment time and shown on the offer. The rider's payout rate is set in admin settings and is separate from the customer's delivery fee.

## 6. Restaurant app requirements

Screens T01 to T12. Restaurants work on a phone or a tablet at the counter, so layouts must scale to tablet width and stay usable when the screen is left on for a full shift.

| ID | Requirement | Pri |
| --- | --- | --- |
| RES-01 | Sign in with owner- or admin-issued credentials; owner has 2FA; staff accounts are created and removed by the owner | M |
| RES-02 | New order alert with a looping sound and full-screen takeover until acted on; works with the screen locked and respects device volume | M |
| RES-03 | Order ticket shows items, modifiers, notes, payment type (paid or COD), total, and a countdown to the response deadline (5 min default) | M |
| RES-04 | Accept with a prep time (10 to 60 min presets) or reject with a required reason; unanswered orders auto-reject at the deadline and the customer is told | M |
| RES-05 | Preparing board with timers; mark individual items unavailable mid-order, which triggers a customer substitution or partial refund flow | M |
| RES-06 | Mark ready; the dispatcher and assigned rider see it instantly; the restaurant sees the rider's name, photo and ETA to the shop | M |
| RES-07 | Handover: restaurant confirms the rider's order number (or scans the order QR) before releasing the bag | M |
| RES-08 | Menu management: categories, items, prices, photos, modifiers, sold-out toggle; price and new-item changes go to the admin for approval, sold-out toggles apply instantly | M |
| RES-09 | Change requests list shows pending, approved, rejected with the admin's note | M |
| RES-10 | Opening hours with weekly schedule, holiday overrides, and a pause button (15, 30, 60 min or until reopened) that stops new orders | M |
| RES-11 | Payouts: statement per settlement period, orders included, fees deducted, net amount, status, and downloadable PDF or CSV | M |
| RES-12 | Reviews: customer ratings and comments, with a reply option; the admin can hide abusive reviews | S |
| RES-13 | Order history and daily sales summary with export | M |
| RES-14 | Printer support for Bluetooth thermal printers to print kitchen tickets | C |
| RES-15 | Multi-branch: one owner account managing several outlets with a branch switcher | C |

### Key rules

- The kitchen sees an order only once it is confirmed payable: COD and card orders appear immediately; a bank-transfer order appears only after the admin verifies the slip (decision to confirm with the business, see section 18).
- The restaurant never sees the customer's phone or full address; the first name and delivery area are enough to prepare the order.
- Restaurants pay a monthly subscription fee; the business settles restaurants for food revenue on the payout cycle (weekly, Monday).

## 7. Admin and dispatch console requirements

Screens A01 to A22. This is the control room of the business. Dispatchers work live orders; the owner also manages money, staff and settings.

| ID | Requirement | Role | Pri |
| --- | --- | --- | --- |
| ADM-01 | Orders board grouped by stage (new, preparing, ready, unassigned, out for delivery, done) with live updates, age timers and colour alerts when an order waits too long | Both | M |
| ADM-02 | Order detail: customer, restaurant, items, payment, timeline of every event with timestamps and actor, internal notes, and actions (reassign, cancel, refund, contact) | Both | M |
| ADM-03 | Assign rider: list view of riders with status, distance to the restaurant, active jobs, cash held and rating; map view with the same data; send an offer to one rider | Both | M |
| ADM-04 | Batch builder: combine 2 to 3 orders (pickups and drop-offs) into one run, preview the route, offer the batch to one rider | Both | M |
| ADM-05 | Offer pending view: who has the offer, time left, and a one-tap cancel and re-offer; decline and timeout reasons logged | Both | M |
| ADM-06 | Live map of all online riders and active orders, with rider status colours and stale-location warnings | Both | M |
| ADM-07 | Rider list with status (online, offline, on job, paused), filters and search; rider detail with jobs, earnings, cash on hand, documents, rating and an action menu | Both | M |
| ADM-08 | Create account: riders, restaurant owners, restaurant staff and dispatchers, with credentials issued once, shown once, and a forced reset on first login | Owner (riders and restaurants: dispatcher may create) | M |
| ADM-09 | Cash handover: record cash a rider hands to the office against their COD balance, with variance reasons and a signed receipt | Both | M |
| ADM-10 | Bank slip checks: queue of uploaded slips with image, amount, reference and expiry; approve, reject with a reason, or ask for a new slip | Both | M |
| ADM-11 | Restaurants: list, status, hours, subscription state, commission or fee rules, and an on/off switch | Owner | M |
| ADM-12 | Menu approvals queue with a before-and-after view for price and item changes | Owner | M |
| ADM-13 | Restaurant settlements: generate a period statement, review, mark paid, export | Owner | M |
| ADM-14 | Rider payouts: compute per-delivery pay, adjustments and deductions, mark paid, export | Owner | M |
| ADM-15 | Customers: search, order history, blocks and flags, COD eligibility | Both (block: owner) | M |
| ADM-16 | Cancel and refund: reason codes, refund method, amount, approval cap for dispatchers (set in settings), and a trail | Both with caps | M |
| ADM-17 | Reports: orders, delivery times, failure reasons, rider and restaurant performance, cash position, with date filters and CSV export | Owner | M |
| ADM-18 | Settings: base fee 150, per km 55, max radius 10 km, minimum order, COD limit, timers, rider caps, refund cap, payout cycle, bank details | Owner | M |
| ADM-19 | Staff management: dispatcher accounts, role changes, deactivation, forced sign-out | Owner | M |
| ADM-20 | Support case queue linked to orders (customer reports, rider issues) with assignee, status and resolution notes | Both | M |
| ADM-21 | Audit log: searchable, filterable, append-only record of every sensitive action | Owner | M |
| ADM-22 | Broadcast: send an announcement or an emergency message to all riders or restaurants | Owner | S |

### Key rules

- An order unassigned beyond the alert timer (5 min default) turns red on the board and notifies every dispatcher on shift.
- Two dispatchers cannot assign the same order; the first to open the assign flow holds a soft lock for 30 s, and the server rejects any conflicting offer.
- Every manual override (reassign, price change, refund, cash write-off) requires a reason code.

## 8. Order lifecycle, dispatch and assignment rules

An order runs on two tracks at once: the kitchen prepares while a dispatcher finds a rider, and the two meet at pickup.

&#91;embedded content: order lifecycle · two parallel tracks, 3 exit states\]

The delivery track starts the moment the restaurant accepts, so the rider can already be on the way while the food is cooked. Any order can leave through an exit state until it is delivered.

### Who moves the order

| Step | Moved by | Guard |
| --- | --- | --- |
| Placed to Awaiting restaurant | System | COD or card: immediately. Bank transfer: after the admin approves the slip |
| Awaiting restaurant to Preparing | Restaurant | Accept with a prep time, or reject with a reason |
| Preparing to Ready | Restaurant | Swipe to mark ready |
| Unassigned to Offered | Dispatcher | Rider passes the eligibility check below |
| Offered to Rider assigned | Rider | Accepts inside 60 s |
| Ready plus Assigned to Picked up | Rider | Swipes after order number and item count check; restaurant confirms handover |
| Picked up to Delivered | Rider | Swipes at the drop-off; COD cash amount entered |

### Timers (all configurable in settings)

| Timer | Default | If it runs out |
| --- | --- | --- |
| Restaurant must respond | 5 min | Auto-reject, customer told, online payment refunded |
| Bank slip window | 30 min | Order auto-cancels, no charge |
| Rider offer | 60 s | Counts as a miss; offer returns to the dispatcher |
| Unassigned alert | 5 min after accept | Board card turns red; every dispatcher on shift is notified |

### Assignment rules

1. Assignment is manual. Only a dispatcher or the owner can send an offer, and to one rider at a time.
2. A rider is eligible only if online, not paused, under the active-job cap (3), under the cash cap (15,000 LKR), and has not already declined this order.
3. The assign screen sorts eligible riders by distance to the restaurant, then active jobs, then cash held, then rating. This is a suggestion; the dispatcher can choose anyone eligible.
4. A batch is built by a dispatcher from 2 to 3 orders and offered to one rider as one run; each customer still sees only their own order.
5. Before pickup a dispatcher can cancel the offer or the assignment and re-offer; the rider and the customer are told. After pickup, reassignment needs a reason code and is logged.
6. Two dispatchers cannot assign one order: the first holds a 30 s soft lock and the server rejects a second offer.
7. Every status change is a timestamped event with actor and device; the order timeline is rebuilt from these events, never edited.

## 9. Pricing, payments, settlements and reconciliation

The delivery fee is separate from food prices: **150 LKR base + 55 LKR per km**, measured on the driving route from restaurant to customer. A 6 km route costs 150 + 6 × 55 = 480 LKR. Money is stored as integer cents (LKR minor units) in a double-entry ledger, never as floating-point.

### Money flow by payment method

| Method | Who holds the money first | Order becomes active | Where it ends up |
| --- | --- | --- | --- |
| Cash on delivery | Rider, at the door | Immediately | Rider hands cash to the office (ADM-09); business pays the restaurant at settlement |
| Bank transfer | Business bank account | After the admin verifies the slip | Already with the business; restaurant settled on the cycle |
| Card / online | Payment gateway, then business bank | Once the gateway confirms payment | Gateway payout to the business bank; restaurant settled on the cycle |

### Settlement and payouts

- **Restaurants:** the business settles food revenue weekly (Monday), net of any agreed fee and refunds attributed to the restaurant. Restaurants also pay a monthly subscription, invoiced and tracked separately.
- **Riders:** paid per delivery. The rate is set in settings and shown on the offer; adjustments (bonus, penalty, tips) are itemised. Payout cycle is weekly unless the owner changes it.
- **Cash:** every COD order creates a cash liability on the rider; the liability clears only when a handover is recorded by a dispatcher and, above a variance threshold, countersigned by the owner.

### Reconciliation controls

1. Ledger entries are append-only; corrections are new reversing entries.
2. A daily job compares delivered-order totals, gateway reports, bank slips approved and cash handovers recorded, and flags any difference to the owner.
3. Each rider has a cash balance; exceeding the cap (15,000 LKR) blocks new COD offers until a handover is recorded.
4. Settlement statements are immutable once marked paid and carry a checksum.

### Refunds and cancellations

| Situation | Refund |
| --- | --- |
| Customer cancels before restaurant accepts | Full, automatic |
| Restaurant rejects or times out | Full, automatic |
| Customer cancels after accept, before pickup | Decided by dispatcher: food cost may be retained; delivery fee refunded |
| Missing or wrong item | Item value refunded, reason code, attributed to restaurant or rider |
| Late delivery or rider fault | Delivery fee or goodwill credit at the dispatcher's cap, above it owner approval |
| Bank slip not verified in the window | Order auto-cancels; no charge |

Refunds go back by the original method where possible; COD refunds are issued as credit or a bank transfer, never as cash from a rider.

### Gateway and compliance

- Use a licensed Sri Lankan card/online gateway that provides hosted checkout, 3-D Secure and webhooks (provider to be selected, section 18). Card data is never stored or logged by Oyo Eats.
- Payment webhooks are signature-verified and idempotent; a payment is never marked paid from the client app's word.
- Tax treatment (VAT or service charge on delivery fees and subscriptions) is to be confirmed with the business's accountant and made a configurable rule, not hard-coded.

## 10. Notifications and communications

Every state change that a person must act on or wants to know about triggers a notification on the right channel. Push is the default; SMS is the fallback for critical events when push is not delivered.

| Event | Customer | Rider | Restaurant | Dispatcher |
| --- | --- | --- | --- | --- |
| Order placed | Push | n/a | Alarm + push | Board update |
| Slip uploaded | In-app | n/a | n/a | Push + badge |
| Restaurant accepted or rejected | Push | n/a | n/a | Board update |
| Rider offered | n/a | Alarm + push | n/a | Offer timer |
| Rider accepted | Push + on-screen pop-up with rider details | n/a | Push (rider on the way) | Board update |
| Offer declined or expired | n/a | n/a | n/a | Push + alert |
| Order ready | Push | Push | n/a | Board update |
| Picked up | Push | n/a | n/a | Board update |
| Arriving (500 m) | Push | n/a | n/a | n/a |
| Delivered | Push + rating prompt | Summary | Push | Board update |
| Unassigned beyond 5 min | n/a | n/a | n/a | Escalation to all dispatchers |
| Rider issue or emergency | n/a | Confirmation | n/a | Alarm + push |
| Refund issued | Push + SMS | n/a | n/a | n/a |
| Payout paid | n/a | Push | Push | n/a |

### Requirements

- NOT-01: Delivery of critical notifications (new order to restaurant, offer to rider, rider assigned to customer) is tracked per message; a missing delivery receipt within 20 s triggers an SMS or a dispatcher alert.
- NOT-02: The customer pop-up on rider assignment appears in the foreground; in the background it is a high-priority push that opens the same screen.
- NOT-03: Users can mute marketing messages but not transactional ones.
- NOT-04: SMS provider has a fallback provider; OTP delivery success rate is monitored and alerts below 95%.
- NOT-05: Message templates are versioned and editable by the owner without a release; sensitive data (full address, card digits) never appears in a push or SMS.
- NOT-06: In-app notification centre keeps the last 30 days per user.

## 11. Security requirements

The app handles money, cash, home addresses, live locations and phone numbers, so security is a release gate, not a later phase. Controls follow the OWASP Mobile Application Security Verification Standard (MASVS) and the OWASP API Security Top 10 as the baseline.

### 11.1 Authentication and sessions

| ID | Requirement |
| --- | --- |
| SEC-01 | Customer OTP: 6 digits, single use, 5 min expiry, 5 attempts then 15 min lock; rate-limited per phone number and per IP; OTP stored only as a salted hash |
| SEC-02 | Staff, rider and restaurant passwords: minimum 10 characters, checked against a breached-password list, hashed with Argon2id; forced change on first login and on admin reset |
| SEC-03 | Two-factor authentication (TOTP app) mandatory for owner, dispatcher and restaurant owner accounts |
| SEC-04 | Short-lived access tokens (15 min) with rotating refresh tokens; refresh reuse detection revokes the whole session family |
| SEC-05 | Tokens stored in the platform secure store (iOS Keychain, Android Keystore), never in plain local storage or logs |
| SEC-06 | Device binding for riders and restaurants; a new device needs admin approval; lost device can be wiped remotely by revoking tokens |
| SEC-07 | Failed-login lockout with back-off; admin alert on repeated failures against staff accounts |
| SEC-08 | Admin console sessions time out after 30 min idle; sign-in from a new country or device raises an alert |

### 11.2 Authorisation and multi-tenancy

| ID | Requirement |
| --- | --- |
| SEC-09 | Role-based access control enforced in the API for every endpoint, with deny by default |
| SEC-10 | Object-level checks on every read and write (user may touch only their own orders, jobs or restaurant); automated tests try cross-user and cross-tenant access on every endpoint |
| SEC-11 | Tenant identifier on every row and in every query via a mandatory data-access layer; database row-level security as a second line of defence |
| SEC-12 | Field-level exposure rules: customer phone and full address are released to a rider only after acceptance and withdrawn at order close |
| SEC-13 | Privileged actions (refund over cap, settings change, account creation, cash write-off) require a recent re-authentication |

### 11.3 Data protection

| ID | Requirement |
| --- | --- |
| SEC-14 | TLS 1.2 or higher everywhere with HSTS; certificate pinning in the mobile apps with a safe rotation plan |
| SEC-15 | Encryption at rest for databases, object storage and backups using managed keys; key rotation at least yearly |
| SEC-16 | Sensitive columns (phone, address, bank details, ID document numbers) additionally encrypted at the application layer |
| SEC-17 | Uploaded slips, rider documents and photos stored in private buckets, served only through short-lived signed URLs, with EXIF location stripped |
| SEC-18 | Secrets in a managed secrets vault, never in the repository or app bundle; no production data in test environments |
| SEC-19 | Logs exclude passwords, tokens, OTPs, card data and full addresses; log access is itself audited |

### 11.4 Payments security

| ID | Requirement |
| --- | --- |
| SEC-20 | Card data handled only by the gateway's hosted page (PCI DSS SAQ A scope); no card numbers touch Oyo Eats servers or devices |
| SEC-21 | Webhooks verified by signature and replay window; payment status changes only from verified gateway events or admin action |
| SEC-22 | Every money-moving endpoint requires an idempotency key to prevent double charges, double refunds and double payouts |
| SEC-23 | Order totals and delivery fees are always recomputed on the server; the client's numbers are never trusted |
| SEC-24 | Bank slip checks guard against reuse: the same image hash or reference cannot be attached to two orders |

### 11.5 Application and API hardening

| ID | Requirement |
| --- | --- |
| SEC-25 | Input validation and output encoding on all inputs; parameterised queries only; strict file type and size checks on uploads with malware scanning |
| SEC-26 | Rate limiting and bot protection on login, OTP, order placement, promo codes and search |
| SEC-27 | Mobile apps: root and jailbreak detection (warn, and block for riders handling cash), code obfuscation, no debug builds in production, screenshot blocking on sensitive screens |
| SEC-28 | Mock-location and GPS spoofing detection for riders with flags to dispatchers |
| SEC-29 | Dependency scanning, software bill of materials, and a patch SLA (critical fixes within 72 hours) |
| SEC-30 | Admin console behind SSO or 2FA with optional IP allowlist for the owner role |

### 11.6 Audit, detection and response

| ID | Requirement |
| --- | --- |
| SEC-31 | Append-only audit log for sign-ins, permission changes, account creation, refunds, settings, payouts, cash handovers and data exports, with actor, time, IP, device and before and after values |
| SEC-32 | Security monitoring with alerts on unusual patterns: bulk data export, many failed logins, refund spikes, one rider with large cash and repeated variances |
| SEC-33 | A written incident-response plan with severity levels, a named owner, customer and regulator notification steps, and a yearly drill |
| SEC-34 | Independent penetration test of the apps, APIs and admin console before launch and yearly, with all high findings closed before go-live |
| SEC-35 | Immutable, tested backups; restore drill each quarter |

### 11.7 Fraud and abuse controls

- Fake orders: phone-verified accounts, COD limit, new-account COD cap, and automatic COD blocking after repeated refusals.
- Rider fraud: delivery confirmation near the drop-off point, cash variance tracking, location-spoof flags, and customer "not received" cross-checks.
- Restaurant fraud: price-change approval, sudden-menu-change alerts, and rating-manipulation detection.
- Promo abuse: one redemption per verified phone and device, with limits per campaign.
- Account takeover: new-device alerts to the user, and forced sign-out on password change.

## 12. Privacy and legal compliance

The core duties of Sri Lanka's Personal Data Protection Act No. 9 of 2022 (controller and processor duties, breach reporting, impact assessments, cross-border transfers) take effect on **1 January 2027** under [Gazette 2498/16 of 22 July 2026](https://www.ft.lk/front-page/Data-protection-compliance-regime-takes-effect-on-1-Jan-2027/44-795776), so Oyo Eats must be compliant from the day it goes live, not retrofitted. The Act is modelled closely on the EU GDPR and also reaches overseas entities serving people in Sri Lanka ([Data Protection Authority background](https://dpa.gov.lk/Background.php)). This section is an engineering requirement set, not legal advice; the business's lawyer must confirm it.

| ID | Requirement |
| --- | --- |
| PRI-01 | Name the business as data controller; appoint a Data Protection Officer if the legal test is met, or a named privacy owner regardless |
| PRI-02 | Record of processing: what personal data is held per role, the purpose, the lawful basis, who receives it, and how long it is kept |
| PRI-03 | Consent and notice at sign-up: a plain-language privacy notice and terms; location and notification permissions asked in context, with a reason, and optional where possible |
| PRI-04 | Data minimisation: collect only what delivery needs; riders' locations are collected only while online and kept for the retention period below |
| PRI-05 | Data subject rights in-app and via support: access a copy, correct, delete, object, and restrict processing, answered within a fixed service level |
| PRI-06 | Account deletion removes or anonymises personal data within 30 days, keeping only what law requires (financial and tax records) in anonymised or pseudonymised form |
| PRI-07 | Data protection impact assessment completed before launch for live location tracking, rider identity documents and payment data |
| PRI-08 | Written processor contracts with every vendor that touches personal data (cloud host, SMS, push, maps, payment gateway, analytics), including breach duties |
| PRI-09 | Cross-border transfer check: host data in a region and with vendors whose transfer basis is documented; the cloud region and vendor list are decided with the lawyer (section 18) |
| PRI-10 | Personal-data breach procedure that reports to the Data Protection Authority and affected people within the legal deadline, which the lawyer confirms once the rules are final |
| PRI-11 | Staff and rider confidentiality agreements and training; dispatchers see customer data only for live orders and support |
| PRI-12 | Children: the app is for adults; it does not knowingly collect children's data, and sign-up asks for age confirmation |

### Retention schedule (proposed, to be confirmed)

| Data | Kept for | Then |
| --- | --- | --- |
| Rider live location trail | 90 days | Delete; keep only aggregated delivery distance |
| Customer address and phone on closed orders | 12 months | Remove from the order; keep a hashed reference |
| Bank slip images | 12 months | Delete image; keep verified amount and reference |
| Support chats and photos | 12 months | Delete |
| Financial ledger, invoices, settlements | As required by tax and company law, typically 6 years | Keep, anonymise personal fields |
| Audit log | 7 years | Archive |
| Rider identity documents | Length of engagement + 12 months | Delete |

### Other legal items

- Terms of service, privacy policy, rider agreement (contractor or employee status to be decided by the business), restaurant agreement (subscription, settlement, menu approval) and a refund policy are required before launch.
- Food safety: the restaurant is responsible for its food-handling licences; the app stores each restaurant's licence number and expiry and blocks ordering if it lapses.
- VAT and invoicing on delivery fees and subscriptions are set with the business's accountant and held as configurable rules.
- Rider road safety: speed and phone-use guidance in onboarding; no in-app interaction while the vehicle is moving beyond a voice alert.

Sources: [FT.lk, PDPA compliance regime takes effect on 1 Jan 2027](https://www.ft.lk/front-page/Data-protection-compliance-regime-takes-effect-on-1-Jan-2027/44-795776) · [Data Protection Authority, background](https://dpa.gov.lk/Background.php) · retrieved 2026-10-30.

## 13. Non-functional requirements

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-01 | Availability | 99.9% monthly for order, dispatch and payment APIs; planned maintenance only outside 11:00 to 15:00 and 18:00 to 22:00 local time |
| NFR-02 | Performance | API p95 under 400 ms for reads and 800 ms for writes; app cold start under 3 s on a mid-range Android phone |
| NFR-03 | Real-time | Board and order status updates reach clients within 2 s; rider position updates visible to dispatchers within 5 s |
| NFR-04 | Capacity | Designed for 5,000 orders per day and 300 online riders at launch, with a clear path to 10x by adding capacity without redesign |
| NFR-05 | Peak load | Sustain 3x average hourly orders at the lunch and dinner peaks; load-tested before launch |
| NFR-06 | Data durability | Point-in-time database recovery, RPO 5 min, RTO 1 hour; backups copied to a second region |
| NFR-07 | Offline and poor networks | Riders and restaurants keep a working screen on weak 3G; queued actions sync with conflict rules; customer cart survives drops |
| NFR-08 | Devices | Android 8+ and iOS 15+; low-RAM Android handsets are a first-class target since riders use them |
| NFR-09 | Battery and data | Rider app uses under 8% battery per hour on a job and under 30 MB per shift of mobile data |
| NFR-10 | Accessibility | Dynamic text sizes, 4.5:1 contrast, labelled controls, and screen-reader support on the customer app |
| NFR-11 | Localisation | English at launch; strings externalised so Sinhala and Tamil can be added; LKR formatting, local phone formats, 12-hour time and Asia/Colombo timezone |
| NFR-12 | Observability | Structured logs, metrics, traces and a single-page health dashboard; alerts to an on-call phone |
| NFR-13 | Maintainability | CI/CD with automated tests on every change, feature flags for risky releases, and database migrations that are reversible |
| NFR-14 | Compatibility of maps | Routing and distance calculations use one provider consistently so the fee shown equals the fee charged |
| NFR-15 | Time | All timestamps stored in UTC, shown in local time; server clock is the single source for timers |

## 14. System architecture and data model

The apps never talk to a database or a provider directly: every request passes the gateway, which checks who the user is and what they may touch before a service sees it.

&#91;embedded content: recommended architecture · clients, gateway, services, data, third parties\]

This is a recommended shape, independent of the build team's language and framework choice. Real-time updates use WebSocket with push as the fallback, and every money-moving call carries an idempotency key.

### Multi-tenancy

The delivery business is the platform owner. Each restaurant is a tenant whose staff can reach only its own menu, orders and payouts; riders and customers are platform-level users scoped to their own jobs and orders. A tenant id sits on every tenant-owned row and is enforced in the data layer and by database row-level security.

### Core data entities

| Entity | Key fields | Notes |
| --- | --- | --- |
| Account | id, role, phone or username, status, 2FA, device bindings | One role per account |
| Customer address | customer, label, geo point, text, note | Encrypted at the application layer |
| Restaurant | tenant id, name, licence, hours, subscription, bank details | Bank details encrypted |
| Menu item and modifier | restaurant, price, photo, status, approval state | Price changes versioned |
| Order | customer, restaurant, status, totals, payment method, fee inputs | Totals locked at placement |
| Order item | order, item snapshot, modifiers, quantity, price | Snapshot of what was bought |
| Order event | order, type, actor, device, time, payload | Append-only; the timeline is built from it |
| Payment and bank slip | order, method, amount, gateway reference, slip image hash, verifier | Slip hash is unique across orders |
| Rider | account, vehicle, documents, status, cash balance | Documents in private storage |
| Rider presence | rider, online, last location, battery, time | Location trail kept 90 days |
| Offer and batch | order or batch, rider, sent at, outcome, reason | Every decline and timeout logged |
| Cash handover | rider, amount, expected, variance, receipt, recorded by | Variance needs a reason |
| Ledger entry | account, debit or credit, amount in cents, order or settlement ref | Append-only, double-entry |
| Settlement and payout | party, period, lines, total, status, checksum | Immutable once paid |
| Review | order, subject, rating, text, hidden flag | Only for delivered orders |
| Support case | order, reporter, type, evidence, assignee, resolution | Linked to refunds |
| Audit log | actor, action, target, before, after, IP, device, time | Append-only |

## 15. Analytics, KPIs and reporting

The owner needs one honest view of how the business is doing. Reports come from the ledger and event log, not from the apps, so they cannot be edited from a phone.

| Area | Measures | Audience |
| --- | --- | --- |
| Orders | Placed, accepted, rejected, cancelled, delivered; failure reasons; orders per hour and per area | Owner, dispatcher |
| Speed | Placed to accepted, accepted to assigned, assigned to picked up, picked up to delivered, total door time | Owner, dispatcher |
| Dispatch | Offers sent, accepted, declined, expired; reassignment rate; unassigned age at peak | Owner |
| Riders | Deliveries per hour, acceptance rate, rating, late rate, cash held and variance, online hours | Owner |
| Restaurants | Acceptance rate, prep time vs promised, rejections, sold-out frequency, rating | Owner |
| Customers | New vs repeat, order frequency, cancellations, complaint rate, COD refusal rate | Owner |
| Money | Gross order value, delivery fee income, subscriptions, refunds, rider pay cost, cash outstanding, settlement due | Owner |
| Quality | Crash-free sessions, notification delivery, OTP success, payment success | Product and engineering |

### Requirements

- ANA-01: Daily and weekly scheduled report emailed to the owner, with CSV export from the console.
- ANA-02: Product analytics events are pseudonymous, exclude personal data and payment details, and respect the customer's marketing choice.
- ANA-03: A single definition per metric, written down and shared between the console and the reports.
- ANA-04: Heat map of demand and unassigned orders by area and hour, to guide where riders should wait.

## 16. Operations and support

A delivery business lives or dies on its worst hour, so the operating model is part of the product.

### Daily operations

| Moment | Who | What |
| --- | --- | --- |
| Before open | Dispatcher lead | Confirm riders online, restaurants open, system health green, cash balances within cap |
| Peak hours | Two dispatchers minimum | One on the board, one on exceptions and support |
| Close | Dispatcher + owner | Cash handover totals, unresolved cases, bank slips cleared, daily reconciliation report reviewed |
| Weekly | Owner | Restaurant and rider settlement run, review audit log and security alerts |

### Support playbooks (each needs a screen flow, a message template and a refund rule)

- Restaurant rejects or goes silent: auto-reject at 5 min, re-offer the customer another restaurant, refund online payments.
- No rider accepts: escalate after 5 min, widen the rider search, call riders directly, tell the customer honestly about the delay and offer to cancel.
- Rider unreachable or stuck: dispatcher calls, reassigns, and the original rider is paused until cleared.
- Customer not answering at the door: call twice, wait 5 min, then follow the no-show rule (food retained, delivery fee charged for prepaid orders).
- Wrong or missing items: photo evidence, refund by item, attributed to restaurant or rider.
- Rider accident or emergency: the emergency flow alerts the dispatcher; owner contact tree and insurance steps documented.
- Bank slip dispute: second dispatcher reviews; the owner has the final decision.

### Platform operations

- Monitoring and alerting 24 hours, with a named on-call engineer during service hours and a defined escalation path.
- Incident severity levels: S1 (orders cannot be placed or assigned) acknowledged within 15 min and updated every 30 min; S2 (degraded) within 1 hour.
- A fallback "manual mode": if the app is down, dispatchers can take orders by phone and run them in the console, and riders receive jobs by call or message; the procedure is written and rehearsed.
- Releases outside peak hours, with staged rollout (5%, 25%, 100%), and one-click rollback.
- Quarterly backup restore test, yearly disaster-recovery drill, and a post-incident review for every S1 and S2.

## 17. Quality, testing and release plan

Nothing goes live until every launch gate below is met.

| Layer | What is tested | Tooling and rule |
| --- | --- | --- |
| Unit and logic | Fee calculation, state machine transitions, refund rules, ledger entries, permission checks | Every rule in sections 8 and 9 has tests; no merge without green |
| API and contract | Every endpoint against its schema, auth, and object-level access | Automated cross-role and cross-tenant attack tests on every endpoint |
| End to end | Full order journeys per payment method, reject, cancel, reassign, batch, refund | Scripted runs on real devices and emulators each release |
| Real-time | Dispatcher board, tracking, notifications under load and flaky networks | Load test at 3x peak; network throttling tests |
| Security | Static analysis, dependency scan, secrets scan, and a penetration test by an independent party | All high and critical findings closed before launch |
| Payments | Gateway sandbox runs, webhook replay and failure, double-submit, partial refunds | Reconciliation test matches ledger to gateway report to the cent |
| Usability | Real riders, restaurant staff and dispatchers use the apps on shift-like tasks | Task success and time targets agreed before the test |
| Device matrix | Low-end Android, mid-range, current iOS, tablet for restaurants | Pass on the defined matrix |
| Accessibility and localisation | Large text, screen reader, string overflow | Checklist per screen |

### Release approach

1. **Build and internal test:** the business team uses the app against sandbox data.
2. **Closed pilot:** a small group of restaurants, riders and invited customers in one delivery zone, with the manual fallback ready, for at least 2 weeks.
3. **Staged launch:** widen zones and restaurants while the success metrics in section 1 hold.
4. **General availability:** public store release, marketing, and the full support rota.

### Launch gates

- [ ] Penetration test passed, high findings closed
- [ ] DPIA complete and privacy notice, terms and consent live
- [ ] Payment reconciliation test passed for all three methods
- [ ] Load test passed at 3x peak
- [ ] Backup restore and manual fallback rehearsed
- [ ] Support rota, playbooks and dispatcher training done
- [ ] Store listings approved (Apple App Store, Google Play)

## 18. Risks, dependencies and open decisions

### Decisions the business must make

| # | Decision | Why it matters | My default if undecided |
| --- | --- | --- | --- |
| 1 | Does the kitchen see a bank-transfer order before the slip is verified? | Speed vs risk of cooking unpaid food | Hold until verified, with a fast-track for trusted customers |
| 2 | Which card/online gateway? | Fees, settlement time, 3-D Secure, refund API | Pick a licensed local gateway with hosted checkout and webhooks |
| 3 | Are riders employees or contractors? | Pay, insurance, device policy, legal duties | Confirm with the lawyer before the rider agreement is drafted |
| 4 | Rider pay per delivery: flat, distance-based, or both? | Cost model and rider retention | Base plus a share of the distance fee |
| 5 | Restaurant fee model: subscription only, or subscription plus per-order fee? | Revenue and restaurant acceptance | Subscription only at launch, as stated |
| 6 | COD limit, minimum order, and dispatcher refund cap values | Fraud exposure | Set at launch values in settings, review weekly |
| 7 | Cloud region and vendor list | PDPA cross-border rules, latency, cost | Choose with the lawyer; document each vendor |
| 8 | VAT or service charge treatment | Invoices and settlements | Accountant decides; rule is configurable |
| 9 | Maps and routing provider | Fee accuracy, cost, offline coverage | One provider for distance and ETA |
| 10 | Launch zone and first restaurants | Pilot scope | One dense zone with 8 to 12 restaurants and 20 to 30 riders |

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Dispatchers overwhelmed at peak | Late orders, unhappy customers | Rider suggestions, alert timers, two-person peak rota, batching tool |
| Rider cash loss or fraud | Direct financial loss | Cash cap, handover variance tracking, countersign, frequent handovers |
| Restaurant slow or no response | Failed orders | 5 min auto-reject, alarm alerts, response metrics on the restaurant list |
| GPS or data unreliable | Wrong ETAs, disputes | Last-known-position display, spoof detection, manual override |
| Data breach | Legal, financial, reputational | Section 11 controls, pen test, breach plan, minimal data held |
| Payment gateway outage | No prepaid orders | COD and bank transfer fallback, status banner |
| Single-provider SMS failure | Customers cannot log in | Secondary SMS provider, monitoring on OTP success |
| Legal gaps at launch (PDPA, contracts) | Penalties, disputes | Lawyer review as a launch gate |
| Scope creep | Delays | This PRD is the baseline; changes go through the owner |

### Dependencies

- A payment gateway account, SMS and push providers, a maps provider, app store accounts, a cloud hosting account and a domain.
- Business bank account for slips and settlement, plus an accountant and a lawyer.
- Restaurant onboarding data: menus, photos, licences, bank details.
- Rider onboarding: identity documents, vehicle details, training.
