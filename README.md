# Cash Tin

A simple till for church fetes, school fairs and other fundraisers. Volunteers tap items, enter the cash handed over, and the app shows the change. Every till at the event syncs to one shared day total.

Built with Expo (React Native, TypeScript) and Firebase (Firestore + anonymous auth).

## How it works

- **Local-first.** Every sale is saved on the phone before anything else, then queued. The queue is sent to Firestore whenever there is signal, so a dead spot in the field never loses a sale.
- **Events and join codes.** The organiser starts an event and gets a 6-character code. Other volunteers enter the code to join. Nobody needs an account; each device signs in anonymously.
- **One shared price list.** Organisers edit it. Changes reach the other tills when they next have signal.
- **Organisers.** The phone that starts an event gets an organiser code on its Event tab. Only organisers can change the price list or void another till's sales. Entering the code on another phone, or after reinstalling, makes that phone an organiser too.
- **Closing the event.** An organiser closes the event at the end of the day. Tills stop taking sales, and Day total offers an end-of-day summary to share as text or a PDF.
- **Day total.** Takings across all tills, split by cash and card, by till and by item, with void and CSV export.
- **No Firebase yet?** With no `.env`, the app runs in local-only mode: everything works on one phone, without sync.

## Getting started

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go, or press `i` / `a` for a simulator.

### Connect Firebase

1. Create a project at console.firebase.google.com (the free Spark plan is enough).
2. **Build > Authentication > Sign-in method:** enable **Anonymous**.
3. **Build > Firestore Database:** create a database (choose `europe-west2` London, or another region near your users).
4. **Project settings > Your apps:** add a **Web app** and copy its config.
5. `cp .env.example .env` and paste the values in.
6. Deploy the security rules:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add        # pick your project
   firebase deploy --only firestore:rules
   ```
7. Restart with `npx expo start --clear`.

## Testing

```bash
npm test              # money, day totals, and offline sync / app-kill tests
npm run test:rules    # Firestore security rules, against the local emulator
npx expo lint
npx tsc --noEmit
```

`npm run test:rules` starts the Firestore emulator, which needs Java (JDK 21 or later) installed. It uses a throwaway demo project, so it never touches your real Firebase data.

## Building for the stores

Builds and submission use EAS (Expo's cloud build service), so you don't need a local Xcode or Android Studio.

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile preview --platform all     # installable test builds
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --platform ios
npx eas-cli@latest submit --platform android
```

Before the first build, change `ios.bundleIdentifier` and `android.package` in `app.json` (currently the placeholder `com.fetetill.app`) to an id you own. Add your `.env` values as EAS environment variables so cloud builds get them.

## Project layout

```
src/app/                 screens (Expo Router)
  index.tsx              start or join an event
  (tabs)/till.tsx        the till
  (tabs)/items.tsx       price list editor
  (tabs)/day.tsx         day total, voids, CSV export
  (tabs)/event.tsx       join code, till name, sync status, leave
src/lib/store.tsx        app state, local storage and the sync outbox
src/lib/cloud.ts         Firestore reads and writes
src/lib/firebase.ts      Firebase setup and anonymous sign-in
src/lib/totals.ts        day-total maths and CSV
src/lib/money.ts         pence formatting and price-list parsing
src/lib/haptics.ts       touch feedback on the till
src/lib/__tests__/       unit and sync tests
tests/rules/             security rules tests
scripts/make-icons.js    draws the app icon and splash image
firestore.rules          who can read and write what
```

Money is always stored as integer pence.

See [PLAN.md](PLAN.md) for the roadmap.
