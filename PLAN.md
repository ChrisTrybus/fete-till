# Build plan

## Done in the first commit

- Expo Router app: start/join event, Till, Price list, Day total, Event tabs.
- Local-first storage with an outbox that retries every 15 seconds and on each new sale.
- Firestore sync: events, join codes, members, sales; live updates from other tills.
- Security rules for codes, events, members and sales.
- Day total by cash/card, till and item; voids; CSV export through the share sheet.
- Local-only mode when Firebase isn't configured.

## Not yet verified

- The app has been typechecked and bundled for Android, but not run on a device.
- `firestore.rules` has not been run against the Firebase emulator. Phase 1 adds tests.

## Phase 1: make it trustworthy (before a real event)

1. Run on iOS and Android devices; fix layout issues on small phones and tablets.
2. Rules tests with `@firebase/rules-unit-testing` and the emulator: non-members can't read an event, a sale can't be edited, codes can't be listed.
3. Sync tests: aeroplane mode for a whole sale session, then reconnect. Kill the app with unsent sales and confirm they survive.
4. Haptic feedback on item taps and sale completion (`expo-haptics`).
5. Keep the screen awake on the Till tab (`expo-keep-awake`).
6. App icon, splash screen and store screenshots.

## Phase 2: organiser features

1. Organiser role: only the event creator can edit the price list or void other tills' sales. Needs the creator to survive reinstalls (sign in with Apple/Google or an organiser PIN).
2. Close the event: lock new sales and produce an end-of-day summary that can be emailed or shared as a PDF.
3. Float tracking: record each till's opening float so "cash in tin" matches the counted cash.
4. Item categories and colours; hide items that have sold out.
5. Reuse last year's price list when starting a new event.

## Phase 3: nice to have

1. Card payments through SumUp or Stripe Terminal tap-to-pay.
2. Gift Aid prompts for donations.
3. Running totals per till on the organiser's phone (a live leaderboard tends to motivate stalls).

## Cost notes

- Each sale is one Firestore write. Each till listening to the sales collection reads every sale once, then only changes.
- A fete with 10 tills and 1,000 sales costs about 1,000 writes and 10,000 reads, well inside the free daily quota (20k writes, 50k reads).
- If many events run on the same day and reads approach the quota, move the day total to a single summary document updated by a Cloud Function, so tills read one document instead of every sale.
