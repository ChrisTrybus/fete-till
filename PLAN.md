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
- Rules tests (`npm run test:rules`): non-members can't read an event, a sale can't be edited or deleted, codes can't be listed, plus joining, voiding and price-list edits. They need the Firestore emulator, which needs Java (JDK 21 or later). All 41 pass, including the organiser, closing and float rules from Phase 2.
- Haptic feedback on item taps and sale completion (`expo-haptics`).
- Screen stays awake while the Till tab is showing (`expo-keep-awake`).
- App icon, Android adaptive icon and splash screen (`npm run icons` redraws them).
- Layout checked in a browser at 320, 600, 768, 820 and 1024 px wide. Fixed: sale lines cut off on small phones, the price list overflowing its card, bunting stopping short on tablets.
- Lint set up (`npx expo lint`) and clean.

Fixed along the way:

- The send loop relied on React re-rendering between sends to see that a sale had been sent. It now updates its own state directly.
- Local-only events queued every sale for a sync that never happens, and the Event tab warned about "unsent changes". They no longer queue anything.
- A change the server refused outright (for example a price list over 200 items) stayed at the front of the outbox and blocked every sale behind it. Refused changes are now set aside so the rest still send. The Event tab lists them with Try again and, for price lists and voids, Discard. A refused sale is never dropped: it stays in this phone's Day total and CSV, marked "not shared". The Price list tab also stops a shared list over 200 items being saved.

Still to do:

1. ~~Run the rules tests.~~ Done.
2. Run on real iOS and Android devices. The browser check doesn't cover safe areas, the keyboard, large system font sizes, haptics or keep-awake.
3. On two real phones: aeroplane mode for a sale session then reconnect, and force-quit with unsent sales. The automated tests cover the app's logic; this checks Firestore and the OS.
4. Store screenshots (take these from the device run).

## Phase 2: organiser features

Done:

- Organiser role. Only an organiser can edit the price list or void another till's sales; a till can still void its own. Starting an event makes an 8-character organiser code, shown on that phone's Event tab. Entering it on the Event tab of another phone (or after a reinstall) makes that phone an organiser too, so no accounts are needed. The code is checked by the security rules and can't be read back by any device. A this-phone-only event has no restrictions.
- Close the event. An organiser closes it on the Event tab (and can reopen it). Every till then shows "This event is closed" instead of the till, and Day total gains an end-of-day summary that can be shared as text or as a PDF (`expo-print`, `expo-sharing`). Closing works with no signal and sends when it can. The server still accepts sales after closing, on purpose: a till with no signal doesn't hear about the close, and what it took must still count. The summary says how many sales were taken after closing.

- Float tracking. Each till enters its opening float on the Event tab. Day total has a "Cash to count" card: each till's float, the cash it took, and what its tin should hold. The float is never counted as takings. The end-of-day summary (text and PDF) and Past events carry the same figures. In a shared event the float travels on the till's member record, so it needs no new kind of queued change; it is set with no signal and sent on the next retry.
- Item categories and colours. On the Price list tab, "Set categories and colours" gives each item a category and a tile colour. The till groups items under their category, in the order the categories first appear in the list, with uncategorised items last. Items in a category share a colour; choosing a colour for one changes the rest. With nothing chosen, colours are picked automatically. A pasted list can carry a category as a third column ("Tea, 0.80, Drinks").
- Sold-out items are hidden on the till. Holding a tile still marks it out of stock; it then moves behind an "N out of stock · Show" row below the items, where holding it brings it back.

Not yet checked:

- The new rules pass their tests in the emulator but have not been deployed. Deploy `firestore.rules` before using a build with this change. Floats work under the rules already deployed; the new rule only adds a check that a float is whole pence and not negative.
- Floats in a shared event have only been run in the automated tests, against a fake server. Floats, categories and the hidden sold-out items were checked in a browser on a this-phone-only event.
- A float that has not yet reached the other tills is not counted in the Event tab's "waiting to send" figure.
- A phone that restarts with a new anonymous sign-in is counted once: floats are taken from each phone’s latest registration. A phone that leaves and rejoins gets its float back. Only a full reinstall, which gives the phone a new identity, can still leave an old float behind to be counted twice.
- Rejoining reads the member list from the server to find the earlier float. That has only run against the fake server in the automated tests.
- The organiser screens only appear in a shared event, so they have not been seen running: there is no Firebase project configured on this machine.
- The PDF has not been made on a device. Closing, the locked till and the summary card were checked in a browser on a this-phone-only event; in a browser "Share as PDF" opens the print dialog instead.
- Events started before this change have no organiser code, so nobody can edit their price list. Start a new event.
- If a phone loses its anonymous sign-in (reinstall, cleared data), it can no longer void the sales it took earlier. An organiser can.

Nothing is left to build in this phase. Reusing last year's price list was done in the free tier work below.

## Free tier (this phone only) and paid event packs

The plan: a single till on one phone is free and needs no backend. Shared events with several tills will need a paid event pack, which also unlocks saved price lists. Until purchases exist, shared events stay free.

Decisions so far:

- Pricing is per event, sold as packs: 99p for one event, £2.99 for five. No subscription.
- Buying any pack unlocks saved price lists on that account for good, not just for that event.
- Shared events stay free until purchases are live, then need a credit. There are no real users yet, so nobody needs notice of the change.
- Sales are never blocked part-way through an event. Any limit applies when starting an event, not during one.
- Free events cost nothing to host: they never touch Firebase.
- Unused credits and saved lists must survive a reinstall, so they are held against a real sign-in, not the anonymous one. The stores do not restore consumable purchases.
- Cloud history writes a summary onto the event when it closes, so listing past events reads one document each rather than every sale.

Done (free tier):

- Starting an event defaults to "Just this phone". "Several tills" is the other choice when sync is set up.
- Past events. Leaving an event saves its sales on the phone (`expo-sqlite` key-value store; browser storage on web). The Past events screen lists them, and each one shows its figures and sales, with the summary, PDF and CSV exports. An event can be deleted from the phone.
- The price list from the last event this phone ran is offered when starting the next one. Till assignments are dropped for a this-phone-only event.

Not yet checked:

- Past events have only been run in a browser, which uses browser storage. The SQLite store has not been run on a device.

Still to do:

1. Accounts: real sign-in, upgrading the anonymous user.
2. Purchases: event packs, validated server-side; creating a shared event uses a credit.
3. Paid features: history kept in the cloud, and saved named price lists.

## Phase 3: nice to have

1. Card payments through SumUp or Stripe Terminal tap-to-pay.
2. Gift Aid prompts for donations.
3. Running totals per till on the organiser's phone (a live leaderboard tends to motivate stalls).

## Cost notes

- Each sale is one Firestore write. Each till listening to the sales collection reads every sale once, then only changes.
- A fete with 10 tills and 1,000 sales costs about 1,000 writes and 10,000 reads, well inside the free daily quota (20k writes, 50k reads).
- If many events run on the same day and reads approach the quota, move the day total to a single summary document updated by a Cloud Function, so tills read one document instead of every sale.
