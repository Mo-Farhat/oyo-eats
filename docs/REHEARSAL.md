# Rehearsal: run a whole delivery day

Five Nawalapitiya restaurants, a dispatcher, riders and customers, with orders coming in on their
own. You play one role (or watch); an autopilot plays the rest. Development only.

## 1. Set up (once, or whenever you want fresh passwords)

```
npm run db:seed -w @oyo/api        # restaurants and menus (adds any that are missing)
npm run demo:setup -w @oyo/api     # makes them live and open all day, resets the demo logins
```

Your logins are in `apps/api/.demo/LOGINS.md` (git-ignored, new passwords on every setup run).
Owner and dispatcher logins need an authenticator code: add the secret from that file to Google
Authenticator (or open the link on your phone). Kitchen staff and rider logins don't.

## 2. Start the app

```
PORT=3001 npm run dev -w @oyo/api  # 3001: port 3000 is taken by another app on this machine
cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:3001 npx expo start --web
```

Open http://localhost:8081. Use a separate browser window (or a private window) per role, so each
keeps its own sign-in. Customers sign in with any `+94 7…` number; the 6-digit code is printed in
the API's terminal.

## 3. Start the simulator

```
npm run demo:simulate -w @oyo/api -- --you kitchen    # or dispatch, rider, none
```

- `--you kitchen`: Hill Top's kitchen is yours (sign in as `demo.kitchen`); most orders go there.
  Accept with a prep time, mark ready; the autopilot dispatch and riders deliver.
- `--you dispatch`: sign in as `demo.dispatch`. Orders arrive accepted by the kitchens; you assign
  riders (Assign Rider on the board), approve bank slips, record cash handovers.
- `--you rider`: sign in as `demo.rider` and go online. The autopilot dispatch offers you jobs
  first; accept, swipe to pick up and to deliver, collect the cash.
- `--you none`: watch the board, reports and statements fill up as the owner (`demo.owner`).

Other options: `--every 120` (seconds between orders, on average), `--minutes 60`,
`--api http://localhost:3001`. Bank-transfer orders upload a slip after 20 s; about 1 in 4 orders
pays by transfer. Some delivered orders get rated; a few get a problem report for the Support queue.

As the owner, try: More → Reports, Settlements (build last week's), Support, Customers, Settings.

## 4. On a phone (Expo Go)

1. Install **Expo Go** from the App Store or Play Store.
2. Phone and computer on the same Wi-Fi. Find the computer's address (`hostname -I`, first one).
3. `cd apps/mobile && EXPO_PUBLIC_API_URL=http://<that-address>:3001 npx expo start` and scan the QR code.

Works in Expo Go: everything except push notifications, the Google map, and rider location with the
screen off (those need the development build; see docs/SETUP-PROVIDERS.md step 6).

## Resetting

`npm run demo:setup -w @oyo/api` again gives fresh passwords and unbinds devices (a rider or
kitchen login is tied to the first phone or browser that signs in). Old test orders stay; ask for a
wipe to start from an empty town.
