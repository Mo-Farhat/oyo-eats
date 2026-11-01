# Needs you

Two lists. Work doesn't stop for either: every item has a stand-in, so the app runs end to end.

1. **From you**: business details, accounts and legal items only you (or your lawyer or accountant) can provide.
2. **Placeholders in use**: stand-ins in the code and data, to swap for the real thing later. Nothing to decide here; it's a checklist for launch.

The design canvas copy and numbers are placeholders too. Where the design and the PRD disagree, the PRD wins (see the end of this file).

## 1. From you

### Business details

- [x] **Office / dispatch phone number**: 072 878 7872, in the app's help, staff sign-in and account messages. Customers get the assigned rider's number instead (C10 pop-up and a Call button on the order).
- [ ] **COD limit, minimum order value, dispatcher refund cap** (PRD section 18, decision 6). Later, by your call. Until set, checkout uses no minimum and no COD limit, and dispatcher refunds need the owner.
- [ ] **Tax / VAT rules for receipts** (decision 8, needs the accountant). Later, by your call. Receipts say "not a tax invoice" until then.
- [x] **Business bank account**: Commercial Bank, Nawalapitiya, Oyo Eats, 1000857557. In the seed and the dev database.
- [x] **Rider pay per delivery** (decision 4): the delivery fee less 10%, rounded to the rupee, fixed when the offer is made (e.g. fee 260 → rider 234). To confirm: "total cost" read as the delivery fee, not the order total.
- [ ] **COD cash variance threshold** (RID-08). Pending your decision. Meanwhile any difference from the total needs a reason.
- [ ] **First restaurants for the Nawalapitiya pilot** (decision 10): names, menus, photos, licence numbers, bank details. Coming; demo placeholders until then. You can also enter them yourself from the Restaurants tab.
- [ ] **Brand assets**: the S02 illustration, app icon and splash at full resolution. Coming with the UI polish.

### Accounts and services

Step-by-step instructions for every account below: [SETUP-PROVIDERS.md](SETUP-PROVIDERS.md).

- [ ] **Apple Developer and Google Play organisation accounts.** Both need a D-U-N-S number (1–2 weeks). Needed before the first store build. 
- [ ] **Google Cloud project with Maps SDK (Android, iOS) and Routes API keys** (NFR-14). Coming. Server key → `GOOGLE_ROUTES_API_KEY` in `apps/api/.env`; app keys → `apps/mobile/.env` (see `apps/mobile/.env.example`). Until then: a grey map panel and straight-line distance x 1.3 for fees.
- [ ] **SMS provider** (Notify.lk, Text.lk or Dialog, plus a fallback). Codes print in the API log in development; production refuses to start without one.
- [ ] **Card gateway account** (iPay), for Milestone 6.
- [ ] **Render, Neon (production project) and Cloudflare accounts**, when we deploy.

### Legal (needs the lawyer)

- [ ] **Terms of Service and Privacy Notice** text and URLs. Sign-up has a required "18+ and agree" checkbox pointing at them.
- [ ] **Cloud region sign-off** for PDPA cross-border rules (Singapore assumed).
- [ ] **Rider status** (employee or contractor) for the rider agreement.

## 2. Placeholders in use

- **Demo restaurants and menus** in Nawalapitiya (`apps/api/src/db/seed.ts`), invented names and prices except Hill Top Kottu House, which follows the design canvas.
- **Riders without a phone**: the demo and preview riders have no number, so customers see no Call button for them. Real riders must have one (required when creating the login).
- **Demo accounts** (one per face) from the seed; they'll double as store-review accounts.
- **Brand illustration**: grey panel with a scooter icon on S02.
- **New-order alarm sound**: a generated two-tone chime (`apps/mobile/assets/sounds/new-order.wav`). Swap in a proper alarm sound.
- **Maps**: grey map panel instead of Google Maps in the app. Road distance uses the Routes API once `GOOGLE_ROUTES_API_KEY` is set (adapter built); straight-line x 1.3 until then.
- **SMS**: console sender in development; the Notify.lk adapter is built and switches on when its keys are set.
- **File storage**: local disk (`apps/api/.uploads`, git-ignored) in development; the Cloudflare R2 adapter is built and switches on when its keys are set.
- **Malware scanning of uploads** (SEC-25): images are fully re-encoded, which neutralises hidden content; a scanner is still needed for any non-image upload (PDF slips, rider documents) before those are accepted.
- **Terms and privacy links**: plain text, no URLs yet.
- **Test data** in the dev database: customers +94770000001, +94770000002, +94775550101 and a few random +9477… numbers from browser test runs (each with one cancelled or delivered order at Hill Top; some were deleted by the account-deletion test, leaving anonymous "Customer" reviews on Hill Top), `preview.dispatch` and `preview.rider` (test logins; credentials only in a scratch file), `preview.kitchen` (a Hill Top staff login for testing; its temporary password is only in a scratch file), a few Hill Top orders left in Ready from kitchen tests, and `preview.dispatcher` (can't sign in again; switch it off from the People tab), `preview.owner` (owner test login for the admin screens; same credentials as `preview.dispatch`, scratch file only), and a suspended "Riverside Rice 0513" restaurant from the onboarding walkthrough. Wipe the dev database before the pilot.

## Design vs PRD (resolved by following the PRD, for the next design pass)

- C01: no draggable map or street search until the Google key; the pin comes from GPS (or the town centre).
- C02 "Closed" restaurants are listed under "Closed Now" below the open ones (the PRD lists open ones; closed ones are shown dimmed for reference).
- C03: the separate "Dishes" results section isn't built yet; restaurant search already matches dish names.
- C06: the order-level "note to restaurant" isn't built yet; per-item kitchen notes are.
- C07: card payment is hidden until Milestone 6.
- A01: "Attention" is a banner for late orders, not a separate tab. Tapping an order's top half opens A02.
- A12: the design has no outright "Reject"; built as Approve, Ask for a New Slip, and Reject Payment (cancels the order) for fake or unpaid slips.
- R02: earnings stats ("[RATE]" in the design) wait for rider pay rates; the map is the grey placeholder.
- T01: "Busy mode" (adds 15 min to customer times) isn't in the PRD and isn't built; the Open switch is.
- T02: the alarm rings while the app is open; ringing with the screen locked needs the native alarm (Notifee) in a development build, next restaurant slice.
- T03: prep presets are 10/15/20/30/45/60 min; the design's free "Custom" entry isn't built.
- C15: the design's "Order notifications" toggle is "Offers and news" (order updates can't be muted, NOT-03).
- C08: the design says "JPG, PNG or PDF"; PDF slips aren't accepted yet (they can't be cleaned the way images are).

- Passwords: design says 8 characters, PRD 10. Built 10. The design's "includes a number" rule is dropped (not in the PRD).
- OTP lock: design says 10 minutes, PRD 15. Built 15.
- A08/A21: logins and device approvals moved from the Riders tab to More → Logins and Devices, so the Riders tab is the A08 list as designed.
- A11: the design has the rider confirm or dispute each handover on R11 and an owner "net against earnings" switch. Built: the rider sees every handover on R11 and the owner signs off differences; dispute and netting come with rider payouts (A17). No printed or signed receipt yet.
- Onboarding: the design has no screens for adding a restaurant, entering its first menu, approving a rider's new phone, or the go-live checklist. Built as: Restaurants tab → Add (profile, pin, licence, payout bank) → setup screen with a checklist (licence, bank account, hours, one menu item, one login) and Go Live. The People tab (was "Riders") holds logins, resets, switch-off and device approval.
- Restaurant logins: the design has them owner-only; PRD ADM-08 lets dispatchers create rider and restaurant logins. Built per the PRD; dispatchers and restaurant setup stay owner-only.
- Restaurant pin: typed coordinates or the phone's location on site, until the Google map picker (needs the Maps key).
- Menu items entered by the owner have one optional choice group (e.g. Size); more groups, photos and dietary tags come with menu management (T07–T09, A15).
- 2FA: no screens in the design; built an enrolment screen after S05 and a code field on S04.
- Sign-up consent: no checkbox in the design; shown on S03 for new numbers.
