// Gift Aid: a UK charity can claim 25p from HMRC for every £1 a UK taxpayer donates,
// as long as the donor has made a declaration with their name and home address.
// It applies to donations only, never to something bought, so only price-list items
// marked as donations count.
import type { GiftAidDeclaration, Item, Sale } from './types';

/** HMRC adds 25p for every £1 donated. */
export const GIFT_AID_RATE = 0.25;

/**
 * The most a single donation can be (pence) to count under HMRC's Gift Aid Small
 * Donations Scheme, which tops up small cash and contactless donations with no
 * declaration. Also where the till starts offering a declaration by default.
 */
export const SMALL_DONATION_MAX = 3000;

/** A donation with no set amount: the till asks how much is being given. */
export const isOpenDonation = (item: Pick<Item, 'donation' | 'price'>) => Boolean(item.donation) && item.price === 0;

/**
 * Whether the till should offer a Gift Aid declaration after this sale. `over` is the
 * event's setting: null when declarations are off, otherwise the donation (pence) that
 * must be exceeded.
 */
export const offersGiftAid = (sale: Pick<Sale, 'lines'>, over: number | null | undefined) => {
  const amount = donationIn(sale);
  return over != null && amount > 0 && amount > over;
};

/** What rounding a total (pence) up to the next whole pound would add. 0 if it is already whole. */
export const roundUpBy = (total: number) => (100 - (total % 100)) % 100;

/** Field lengths HMRC accepts on a Gift Aid schedule. */
export const MAX_NAME = 35;
export const MAX_HOUSE = 40;

/** The donated part of a sale (pence). */
export const donationIn = (sale: Pick<Sale, 'lines'>) =>
  sale.lines.reduce((t, l) => t + (l.donation ? l.price * l.qty : 0), 0);

/** Gift Aid on a donation, rounded down to whole pence as HMRC pays it. */
export const giftAidOn = (pence: number) => Math.floor(pence * GIFT_AID_RATE);

/** "sw1a1aa" → "SW1A 1AA". Returns null if it doesn't look like a UK postcode. */
export function normalisePostcode(text: string): string | null {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export type DeclarationFields = { firstName: string; lastName: string; house: string; postcode: string };

/** What is wrong with the donor's details, or an empty list if they can be saved. */
export function declarationProblems(f: DeclarationFields): string[] {
  const out: string[] = [];
  if (!f.firstName.trim()) out.push('Enter a first name.');
  else if (f.firstName.trim().length > MAX_NAME) out.push(`The first name can be up to ${MAX_NAME} letters.`);
  if (!f.lastName.trim()) out.push('Enter a last name.');
  else if (f.lastName.trim().length > MAX_NAME) out.push(`The last name can be up to ${MAX_NAME} letters.`);
  if (!f.house.trim()) out.push('Enter a house name or number.');
  else if (f.house.trim().length > MAX_HOUSE) out.push(`The house name or number can be up to ${MAX_HOUSE} letters.`);
  if (!normalisePostcode(f.postcode)) out.push('Enter a UK postcode, like SW1A 1AA.');
  return out;
}

/** The statement the donor agrees to, in the words HMRC suggests charities use. */
export const declarationText = (amount: string, charity: string) =>
  `I want to Gift Aid my donation of ${amount} to ${charity}. I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax in the current tax year than the amount of Gift Aid claimed on all my donations, it is my responsibility to pay any difference.`;

export type GiftAidTotals = {
  /** Every donation taken, with or without a declaration (pence). */
  donations: number;
  /** Donations with a declaration (pence). */
  declared: number;
  /** What can be claimed on those (pence). */
  claimable: number;
  /** Declarations that count: their sale hasn't been voided. */
  count: number;
  /** Donations of SMALL_DONATION_MAX or less with no declaration (pence). */
  small: number;
  /** How many sales those were in. */
  smallCount: number;
};

/**
 * Declarations that still count. A voided sale's declaration is left out. A declaration
 * whose sale hasn't reached this phone yet still counts: it was made when the money was taken.
 */
export function liveDeclarations(sales: Sale[], declarations: GiftAidDeclaration[]): GiftAidDeclaration[] {
  const byId = new Map(sales.map((s) => [s.id, s]));
  return declarations.filter((d) => !byId.get(d.saleId)?.voided).sort((a, b) => a.at - b.at);
}

export function giftAidTotals(sales: Sale[], declarations: GiftAidDeclaration[]): GiftAidTotals {
  const live = liveDeclarations(sales, declarations);
  const declared = live.reduce((t, d) => t + d.amount, 0);
  const withDeclaration = new Set(live.map((d) => d.saleId));
  const given = sales.filter((s) => !s.voided).map((s) => ({ id: s.id, amount: donationIn(s) }));
  // One sale is one donor, so the limit is checked against the donation in each sale.
  const small = given.filter((g) => g.amount > 0 && g.amount <= SMALL_DONATION_MAX && !withDeclaration.has(g.id));
  return {
    donations: given.reduce((t, g) => t + g.amount, 0),
    declared,
    claimable: live.reduce((t, d) => t + giftAidOn(d.amount), 0),
    count: live.length,
    small: small.reduce((t, g) => t + g.amount, 0),
    smallCount: small.length,
  };
}

const ddmmyy = (ms: number) => {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${two(d.getFullYear() % 100)}`;
};

/**
 * The declarations as a CSV laid out like HMRC's Gift Aid schedule, one row per
 * donation, ready to paste into the claim spreadsheet.
 */
export function giftAidCsv(sales: Sale[], declarations: GiftAidDeclaration[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [['Title', 'First name or initial', 'Last name', 'House name or number', 'Postcode', 'Aggregated donations', 'Sponsored event', 'Donation date', 'Amount']];
  const saleAt = new Map(sales.map((s) => [s.id, s.at]));
  for (const d of liveDeclarations(sales, declarations)) {
    // HMRC wants the date the donation was received, not when the declaration was made:
    // a donor may come back and Gift Aid it later.
    const donated = saleAt.get(d.saleId) ?? d.donatedAt ?? d.at;
    rows.push(['', d.firstName, d.lastName, d.house, d.postcode, '', '', ddmmyy(donated), (d.amount / 100).toFixed(2)]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
