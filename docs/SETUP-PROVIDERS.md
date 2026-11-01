# Setting up the providers

Step-by-step setup for everything beyond the Neon dev database. Do them roughly in this order: the ones at the top take the longest to approve, so start them first.

**Secrets rule:** never paste API keys, passwords or private keys into chat, email or the repo. Production values go straight into Render's environment settings; development values go in `apps/api/.env` (git-ignored). Tell me when a step is done and I'll wire up and test what needs it.

Screens and menu names at these providers change over time. If a step doesn't match what you see, look for the closest equivalent; the end result is what matters.

---

## 1. Start now: accounts with long approval times

### 1a. D-U-N-S number (needed for Apple, recommended for Google)

1. Go to Apple's D-U-N-S lookup (developer.apple.com → Account → enrol as an organisation; it links to the lookup) or Dun & Bradstreet directly.
2. Search for the company exactly as registered. If it isn't listed, request a number with the business registration details.
3. It's free and usually takes 1–2 weeks. You need the company's legal name, registered address and a contact.

### 1b. Apple Developer Program (organisation), USD 99/year

1. Once you have the D-U-N-S number, enrol at developer.apple.com/programs/enroll as an **Organisation**, not an individual.
2. You'll need the legal entity name, D-U-N-S number, website (oyoeats.lk), and authority to sign for the company. Apple may phone to verify.
3. When approved, in App Store Connect create the app record:
   - Platform iOS, name "Oyo Eats", bundle ID **`lk.oyoeats.app`** (register it under Certificates, Identifiers & Profiles first), primary language English.
4. Create an **APNs key** (Keys → +, enable Apple Push Notifications service). Download the `.p8` file once and keep it safe; note the Key ID and your Team ID. This is for push notifications.

### 1c. Google Play Console (organisation), USD 25 once

1. Sign up at play.google.com/console as an **Organisation** (personal accounts made since late 2023 must run a 14-day test with 12 testers before publishing; organisation accounts don't).
2. Verify the organisation (D-U-N-S helps) and a contact phone and email.
3. Create the app: name "Oyo Eats", app, free. Package name will be **`lk.oyoeats.app`** (set by the first upload).

### 1d. SMS provider: Notify.lk (and a fallback)

The API is ready for Notify.lk. If you prefer Text.lk or Dialog, tell me and I'll add that adapter instead.

1. Create an account at notify.lk and top up a small amount.
2. Request a **sender ID** (for example "OyoEats"). This needs business documents and takes a few days; until it's approved, messages come from a generic sender.
3. From the dashboard, get the **User ID** and **API key**.
4. Later: a second provider as fallback (NOT-04). Not needed for the pilot to start.

Values: `NOTIFYLK_USER_ID`, `NOTIFYLK_API_KEY`, `NOTIFYLK_SENDER_ID`.

---

## 2. Cloudflare: DNS and file storage (R2)

### 2a. Put the domain on Cloudflare

1. Create a Cloudflare account and **Add a site**: `oyoeats.lk` (or your domain). Pick the Free plan.
2. Cloudflare shows two nameservers. At your .lk registrar, replace the domain's nameservers with those two. It can take a few hours.
3. Check the imported DNS records still point your website where it lives now.

### 2b. Create the R2 bucket (private file storage)

1. In the Cloudflare dashboard open **R2 Object Storage** and enable it (it asks for a payment method; the free tier covers 10 GB and has no download fees).
2. **Create bucket**: name `oyo-eats-files`, location hint **Asia-Pacific**. Leave public access **off**: the API hands out short-lived signed links.
3. **Manage R2 API Tokens → Create API token**:
   - Permissions: **Object Read & Write**.
   - Specify bucket: `oyo-eats-files` only.
   - TTL: forever (rotate yearly, SEC-15).
4. Copy the **Access Key ID** and **Secret Access Key** (shown once) and note your **Account ID** (on the R2 overview page).

Values: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=oyo-eats-files`.

---

## 3. Neon: production database

Your dev project stays as is. Production gets its own project.

1. In Neon, **New project**: name `oyo-eats-prod`, Postgres **18**, region **AWS Asia Pacific (Singapore)**.
2. Open the SQL editor on the main branch and run: `CREATE EXTENSION postgis;`
3. Upgrade to a paid plan before launch and set **scale to zero: off** for production compute (otherwise the first request after a quiet spell is slow and timers can lag). Set the point-in-time restore window to at least 7 days (NFR-06).
4. Copy the connection string and make it the **direct** one: in the host, remove `-pooler` (for example `ep-xyz.ap-southeast-1.aws.neon.tech`, not `ep-xyz-pooler...`), and set `sslmode=verify-full`.

Value: `DATABASE_URL`.

---

## 4. Render: run the API

The repo has a `render.yaml` blueprint with the build, migration and health-check settings.

1. Push the repo to GitHub (you said you'll do this).
2. At render.com, sign up and connect GitHub. **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates `oyo-eats-api` in **Singapore** on the **Starter** plan (the free plan sleeps; timers and alarms need it always on).
3. It asks for the secret values. Fill them in:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon production direct connection string (step 3) |
| `HASH_KEY` | new random value: run `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ENCRYPTION_KEY` | another new random value, same command. **Never reuse the dev keys. If this one is lost, encrypted phones and addresses can't be read; keep a copy in a password manager.** |
| `PUBLIC_URL` | `https://api.oyoeats.lk` |
| `R2_*` | from step 2b |
| `NOTIFYLK_*` | from step 1d |
| `GOOGLE_ROUTES_API_KEY` | from step 5 (optional at first) |

4. Deploy. The pre-deploy step runs the database migrations; the health check is `/health`.
5. **Custom domain**: in the service's Settings → Custom Domains, add `api.oyoeats.lk`. Render shows a CNAME target. In Cloudflare DNS add a **CNAME** `api` → that target, with the proxy **off** (grey cloud) so Render can issue the certificate.
6. Create the owner account once: in Render, open the service **Shell** and run `npm run db:seed -w @oyo/api`. In production it only writes settings and the owner; the one-time password is printed once.

The API refuses to start in production if R2, the SMS provider or `PUBLIC_URL` is missing. That's on purpose.

---

## 5. Google Cloud: maps, routes and push

### 5a. Project and billing

1. At console.cloud.google.com create a project `oyo-eats` and attach a billing account. Set a **budget alert** (Billing → Budgets) so a bug can't run up a bill.

### 5b. APIs and keys

1. **APIs & Services → Library**, enable: **Routes API**, **Maps SDK for Android**, **Maps SDK for iOS**. (Places API later, for street search on C01.)
2. **Credentials → Create credentials → API key**, three times, and restrict each:
   - **Server key** (`GOOGLE_ROUTES_API_KEY`): API restriction: Routes API only.
   - **Android key**: application restriction Android apps, package `lk.oyoeats.app` plus the SHA-1 fingerprint (I'll give you this from EAS once the first build exists). API restriction: Maps SDK for Android.
   - **iOS key**: application restriction iOS apps, bundle `lk.oyoeats.app`. API restriction: Maps SDK for iOS.

### 5c. Firebase for Android push

1. At console.firebase.google.com, **add Firebase** to the same Google Cloud project.
2. Add an **Android app** with package `lk.oyoeats.app`; download `google-services.json` and send it to me as a file (it isn't secret like a key, but keep it out of chat logs if you can; put it in `apps/mobile/`).
3. Project settings → Service accounts → **Generate new private key** (FCM v1). This JSON is secret: you'll upload it to EAS yourself (step 6).

---

## 6. Expo / EAS: building the apps

1. Create an account at expo.dev (an **organisation** account, so the team can share it).
2. In this repo, run in your terminal: `cd apps/mobile && npx eas-cli login`, then `npx eas-cli init`. That links the project and adds its ID to `app.json`. Tell me when done and I'll add the build profiles (`eas.json`) and the development build, which the rider's background tracking and the restaurant's locked-screen alarm need.
3. Push credentials, when you have them:
   - Android: `npx eas-cli credentials` → Android → upload the FCM v1 service account JSON (step 5c).
   - iOS: `npx eas-cli credentials` → iOS → push notifications → upload the APNs `.p8` key (step 1b).
4. EAS manages app signing keys for both stores; let it create them.

---

## 7. Later

- **Card payments (iPay)**, Milestone 6: merchant account, sandbox keys, callback URL `https://api.oyoeats.lk/...` (I'll give the exact path).
- **Monitoring (Sentry)**: free tier is enough for the pilot; I'll add it before launch.
- **Second SMS provider** for fallback.
- **Lawyer**: privacy notice and terms (URLs for the sign-up checkbox), PDPA cross-border sign-off for Singapore.

## Checklist of values

| Value | From | Where it goes |
| --- | --- | --- |
| `DATABASE_URL` (prod) | Neon, step 3 | Render |
| `HASH_KEY`, `ENCRYPTION_KEY` (prod) | generate, step 4 | Render (+ password manager) |
| `PUBLIC_URL` | your domain | Render |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare, step 2b | Render (and `apps/api/.env` if you want to test R2 in dev) |
| `NOTIFYLK_USER_ID`, `NOTIFYLK_API_KEY`, `NOTIFYLK_SENDER_ID` | Notify.lk, step 1d | Render (and dev `.env` to test real SMS) |
| `GOOGLE_ROUTES_API_KEY` | Google Cloud, step 5b | Render and dev `.env` |
| Android and iOS Maps keys | Google Cloud, step 5b | tell me; they go in the app config |
| `google-services.json` | Firebase, step 5c | `apps/mobile/` |
| FCM service account JSON, APNs `.p8` | Firebase / Apple | upload to EAS yourself |
