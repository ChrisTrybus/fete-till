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

Done (accounts):

- An Account screen, opened from the start screen and the Event tab when sync is set up. Sign-in is by email and password, Google, or Apple (iOS only, as Apple requires; not offered in a browser). Google needs native code, so it is only offered in a build of the app, never Expo Go; in a browser it uses Firebase's pop-up.
- Making an account links the new sign-in to the phone's anonymous user, so its user id stays the same and it keeps its place, organiser role and own sales in any event. Signing in to an account that already exists changes the id, so that, signing out and deleting the account are refused while the phone is in a shared event. Outside one, an existing Google or Apple account is signed in to instead.
- Email accounts are sent a link to confirm the address; the screen offers to send it again. Forgotten passwords are reset by email. An account can be deleted from the screen (Apple requires this of any app with accounts).
- The account holds nothing yet. Credits and saved price lists will be stored against it.

Not yet checked (accounts):

- Only the signed-out screen has been seen, in a browser. No account has been made against a real Firebase project, and Google and Apple sign-in have not run on a device. They need the providers switched on in Firebase, the Google OAuth client ids (see `.env.example`) as EAS environment variables, and a new build: `usesAppleSignIn` and the Google sign-in module change the native app.
- Email confirmation and password reset emails use Firebase's default templates and sender.

Still to do:

1. Purchases: event packs, validated server-side; creating a shared event uses a credit.
2. Paid features: history kept in the cloud, and saved named price lists.

## Phase 3: nice to have

Done:

- Gift Aid. On the Price list tab ("Set categories, colours and donations") an item can be marked as a donation. Gift Aid only applies to donations, so a sale's purchases never count. After a sale with a donation the till asks "Gift Aid it?", showing the extra 25p in the pound. Yes takes the donor's first and last name, house name or number and postcode, shows the HMRC-style declaration, and saves when the donor agrees. The sale is saved first, so the question never holds up the money. A donor who comes back later can be added from the sale on Day total ("Add Gift Aid", for this phone's own sales). Day total has a Gift Aid card (donations taken, declared, Gift Aid to claim) and organisers can export the declarations as CSV in the columns of HMRC's Gift Aid schedule. Voided sales drop out. The end-of-day summary gives the totals but never a donor's details. Declarations are kept with Past events and can be exported from there.
- In a shared event, declarations go to `events/{id}/giftAid/{saleId}` through the outbox like any other change. The rules let any till add one and only organisers read them, since they hold names and addresses. They can't be edited or deleted; resending the same one is accepted. A refused declaration is set aside on the Event tab; discarding it stops the sending but keeps it in this phone's figures.
- Leaderboard. Organisers in a shared event get "Show leaderboard" on Day total: every till ranked by takings with a bar against the leader, sales count and time since its last sale. Tills that have joined but not sold yet are listed at the bottom; ties share a place. It updates as sales sync, keeps the screen awake, is laid out large on tablets, and "Share standings" sends a short text for the volunteers' group chat.

Not yet checked:

- Deploy `firestore.rules` before using a build with Gift Aid in a shared event. Until then every declaration is refused and set aside (the sales are unaffected). The 6 new rules tests pass in the emulator (47 in all).
- The organiser receiving other tills' declarations has only run against the fake server in the automated tests.
- The leaderboard was checked in a browser with made-up sales from other tills, not in a real shared event.
- The Gift Aid prompt was checked in a browser on a this-phone-only event, not on a device (keyboard, autofill of name and postcode).
- The declaration wording follows HMRC's model declaration and the export follows the schedule's columns. Have the charity's treasurer check both before a real claim. The phone's copy in Past events is not a substitute for the charity keeping its own records.

- Card payments through SumUp, using SumUp's Payment Switch. On the Event tab a phone chooses "Record only" (as before) or "SumUp app". With SumUp, the Card button reads "SumUp": it opens the SumUp app with the amount, the volunteer takes the card there (on a SumUp reader, or Tap to Pay if their account has it), and SumUp sends them back to `fetetill://sumup-callback`. A paid result records the card sale with SumUp's transaction code; a declined one records nothing and keeps the cart. Each stall logs in to its own SumUp account, so the money goes straight to it, with no server and no native module. The payment's id is sent to SumUp and becomes the sale's id, so one payment can only ever record one sale. The waiting payment is saved, so the phone closing the app while SumUp is open loses nothing. While it waits, the till is covered; if SumUp never reports back, the volunteer checks the SumUp app and taps "It was paid" (recorded, marked "check in SumUp") or "It wasn't paid". The SumUp reference shows on Day total and in the CSV. A card payment with a donation is followed by the Gift Aid prompt. Leaving the event is blocked while a payment is with SumUp.

Not yet checked (SumUp):

- Nothing has run against the real SumUp app. It needs an affiliate key (a SumUp account > Settings > For developers > Affiliate Keys, for the app id `com.fetetill.app`) set as `EXPO_PUBLIC_SUMUP_AFFILIATE_KEY`, a build with it, and a phone with the SumUp app logged in to a UK account. Until the key is set, the Card button records card sales as before. In a browser SumUp isn't offered.
- The return to `/sumup-callback`, the waiting screen, settling by hand, and the Gift Aid prompt after a card payment were checked in a browser by opening the return link by hand. On a phone, check that SumUp's return reopens the app on the till, both while it is running and after the OS has closed it.
- SumUp says Payment Switch is no longer actively developed and recommends its native SDKs. Those have no React Native version, so moving to them means writing an Expo native module for SumUp's iOS and Android SDKs, then a development build. The till only talks to SumUp through `src/lib/sumup-open.ts`, so that is the one place to change.

Nothing is left to build in this phase.

Gift Aid rework (donations made a kind of item, declarations off by default):

- A price-list item is either something sold or a donation ("Add a donation"). A donation with its amount left empty asks the till how much is being given, with quick amounts and "Round up to the next pound".
- Declarations are an event setting on the Event tab, off by default, with an amount donations must be over (£30 to start with). It is stored on the event as `giftAidOver` and sent through the outbox; the existing rules already let organisers write it, so nothing needs deploying.
- The till no longer opens a pop-up. After a donation over the amount it shows an "Add Gift Aid" button beside the "Saved" message, which goes when the next sale starts. Day total still has "Add Gift Aid" on each donation sale while the setting is on.
- Day total's card is now "Donations", with donations of £30 or less that have no declaration totalled separately for the Gift Aid Small Donations Scheme.

Not yet checked (Gift Aid rework):

- Checked in a browser on a this-phone-only event at phone width. Not run on a device, on the tablet layout, or in a shared event (the setting reaching other tills is covered by the automated tests against the fake server only).
- Phones on an older build ignore the setting and still open the old pop-up, and show a donation with no amount as a £0.00 item.
- Whether the charity can use the Small Donations Scheme, and the wording about it, is for the treasurer to confirm.
- Past events and the end-of-day summary don't yet show the small-donations figure.

## Cost notes

- Each sale is one Firestore write. Each till listening to the sales collection reads every sale once, then only changes.
- A fete with 10 tills and 1,000 sales costs about 1,000 writes and 10,000 reads, well inside the free daily quota (20k writes, 50k reads).
- If many events run on the same day and reads approach the quota, move the day total to a single summary document updated by a Cloud Function, so tills read one document instead of every sale.
