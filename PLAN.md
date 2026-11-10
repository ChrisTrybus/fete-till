# Build plan

## Done in the first commit

- Expo Router app: start/join event, Till, Price list, Day total, Event tabs.
- Local-first storage with an outbox that retries every 15 seconds and on each new sale.
- Firestore sync: events, join codes, members, sales; live updates from other tills.
- Security rules for codes, events, members and sales.
- Day total by cash/card, till and item; voids; CSV export through the share sheet.
- Local-only mode when Firebase isn't configured.

## Phase 1: make it trustworthy (before a real event)

Done:

- Sync tests (`npm test`): a whole sale session with no signal then reconnecting, signal dropping part-way through a send, and the app being killed with unsent sales. These run the real store against a fake Firestore, so they cover the outbox and device storage, not the network itself.
- Rules tests written (`npm run test:rules`): non-members can't read an event, a sale can't be edited or deleted, codes can't be listed, plus joining, voiding and price-list edits.
- Haptic feedback on item taps and sale completion (`expo-haptics`).
- Screen stays awake while the Till tab is showing (`expo-keep-awake`).
- App icon, Android adaptive icon and splash screen (`npm run icons` redraws them).
- Layout checked in a browser at 320, 600, 768, 820 and 1024 px wide. Fixed: sale lines cut off on small phones, the price list overflowing its card, bunting stopping short on tablets.
- Lint set up (`npx expo lint`) and clean.

Fixed along the way:

- The send loop relied on React re-rendering between sends to see that a sale had been sent. It now updates its own state directly.
- Local-only events queued every sale for a sync that never happens, and the Event tab warned about "unsent changes". They no longer queue anything.

Still to do:

1. Run the rules tests. They need the Firestore emulator, which needs Java (JDK 21 or later). They have not been run yet.
2. Run on real iOS and Android devices. The browser check doesn't cover safe areas, the keyboard, large system font sizes, haptics or keep-awake.
3. On two real phones: aeroplane mode for a sale session then reconnect, and force-quit with unsent sales. The automated tests cover the app's logic; this checks Firestore and the OS.
4. Store screenshots (take these from the device run).
5. Decide what happens when the server permanently refuses a queued change (for example a price list over 200 items). Today it stays at the front of the outbox and blocks every sale behind it.

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
