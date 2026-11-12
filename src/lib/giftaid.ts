// Gift Aid: a UK charity can claim 25p from HMRC for every £1 a UK taxpayer donates,
// as long as the donor has made a declaration with their name and home address.
// It applies to donations only, never to something bought, so only price-list items
// marked as donations count.
import type { GiftAidDeclaration, Sale } from './types';

/** HMRC adds 25p for every £1 donated. */
export const GIFT_AID_RATE = 0.25;

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
  return {
    donations: sales.filter((s) => !s.voided).reduce((t, s) => t + donationIn(s), 0),
    declared,
    claimable: live.reduce((t, d) => t + giftAidOn(d.amount), 0),
    count: live.length,
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
