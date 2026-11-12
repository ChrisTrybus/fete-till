// The end-of-day summary an organiser sends to the treasurer once the event is
// closed: as plain text (for an email or message) and as HTML (printed to a PDF).
import { cashToCount } from './floats';
import { formatPence } from './money';
import { summarise } from './totals';
import type { Sale, TillFloat } from './types';

export type SummaryInput = {
  eventName: string;
  sales: Sale[];
  /** When the event was closed, if it has been. */
  closedAt?: number | null;
  /** Sales on this phone that the other tills don't have, so their summaries will differ. */
  notShared?: number;
  /**
   * Totals saved when a past event ended, for when its individual sales can no
   * longer be read. The headline shows these, and a note says the detail is missing.
   */
  savedTotals?: { takings: number; cash: number; card: number; count: number };
  /** Each till’s opening float. With any set, the summary says what each tin should hold. */
  floats?: TillFloat[];
};

// `text` words a row for the plain-text version, where it isn’t "name: value (count)".
type Section = { title: string; head: [string, string, string]; rows: [string, string, string][]; text?: (row: [string, string, string]) => string };

type Summary = {
  title: string;
  date: string;
  headline: [string, string][];
  notes: string[];
  sections: Section[];
};

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The figures and wording, shared by the text and HTML versions so they can't disagree. */
function build({ eventName, sales, closedAt, notShared = 0, savedTotals, floats = [] }: SummaryInput): Summary {
  const totals = summarise(sales);
  const headline = savedTotals ?? totals;
  const voided = sales.filter((s) => s.voided);
  const live = sales.filter((s) => !s.voided);
  // A till with no signal doesn't hear that the event has closed, and may keep selling.
  const late = closedAt ? live.filter((s) => s.at > closedAt) : [];
  const sum = (list: Sale[]) => list.reduce((t, s) => t + s.total, 0);
  const first = sales.length ? Math.min(...sales.map((s) => s.at)) : (closedAt ?? Date.now());

  const notes: string[] = [];
  if (closedAt) notes.push(`Closed at ${time(closedAt)}${day(closedAt) === day(first) ? '' : ` on ${day(closedAt)}`}.`);
  else notes.push('The event is still open, so these figures may change.');
  if (voided.length) notes.push(`${plural(voided.length, 'voided sale', 'voided sales')} (${formatPence(sum(voided))}) not counted.`);
  if (late.length) notes.push(`Includes ${plural(late.length, 'sale', 'sales')} (${formatPence(sum(late))}) taken after the event was closed.`);
  if (notShared) notes.push(`Includes ${plural(notShared, 'sale', 'sales')} held only on the phone that made this summary.`);
  if (savedTotals) notes.push('The individual sales could not be read, so only the totals saved when the event ended are shown.');

  // What each tin should hold when counted: its float plus the cash it took.
  const tins = cashToCount(savedTotals ? { byTill: [], cash: savedTotals.cash } : totals, floats);
  if (tins.float) notes.push(`The tins started with ${formatPence(tins.float)} in floats, so they should hold ${formatPence(tins.inTin)} in cash.`);
  const tinSection: Section[] =
    tins.float && !savedTotals
      ? [
          {
            title: 'Cash to count',
            head: ['Till', 'Float', 'In tin'],
            rows: tins.rows.map((r) => [r.tillName, formatPence(r.float), formatPence(r.inTin)]),
            text: ([name, float, inTin]) => `${name}: ${inTin} (float ${float})`,
          },
        ]
      : [];

  return {
    title: eventName,
    date: day(first),
    headline: [
      ['Takings', formatPence(headline.takings)],
      ['Cash', formatPence(headline.cash)],
      ['Card', formatPence(headline.card)],
      ['Sales', String(headline.count)],
    ],
    notes,
    sections: [
      ...tinSection,
      { title: 'By till', head: ['Till', 'Sales', 'Takings'], rows: totals.byTill.map((r) => [r.tillName, String(r.count), formatPence(r.value)]) },
      { title: 'By item', head: ['Item', 'Sold', 'Value'], rows: totals.byItem.map((r) => [r.name, String(r.qty), formatPence(r.value)]) },
    ],
  };
}

/** Plain text, laid out to read well in an email or a message. */
export function summaryText(input: SummaryInput): string {
  const s = build(input);
  const out = [`${s.title}: end-of-day summary`, s.date, ''];
  for (const [label, value] of s.headline) out.push(`${label}: ${value}`);
  out.push('', ...s.notes);
  for (const sec of s.sections) {
    if (!sec.rows.length) continue;
    out.push('', sec.title.toUpperCase());
    for (const row of sec.rows) out.push(sec.text ? sec.text(row) : `${row[0]}: ${row[2]} (${row[1]})`);
  }
  out.push('', 'Made with Cash Tin');
  return out.join('\n');
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A one-page document for printing to PDF. Black on white whatever the phone's theme. */
export function summaryHtml(input: SummaryInput): string {
  const s = build(input);
  const table = (sec: Section) =>
    sec.rows.length
      ? `<h2>${esc(sec.title)}</h2><table><thead><tr>${sec.head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${sec.rows
          .map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}: end-of-day summary</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #18261d; background: #fff; margin: 32px; font-size: 14px; }
  h1 { font-size: 26px; margin: 0; }
  .sub { color: #5d6b61; margin: 4px 0 20px; }
  .stats { display: flex; gap: 12px; margin-bottom: 16px; }
  .stat { flex: 1; border: 1px solid #d8e0d6; border-radius: 10px; padding: 10px 12px; }
  .stat.hero { background: #1f6b45; border-color: #1f6b45; color: #fff; }
  .stat .l { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; opacity: 0.8; }
  .stat .v { font-size: 22px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .notes { margin: 0 0 8px; padding: 0; list-style: none; color: #5d6b61; }
  h2 { font-size: 16px; margin: 24px 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 0; border-bottom: 1px solid #d8e0d6; }
  th { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #5d6b61; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 28px; color: #5d6b61; font-size: 11px; }
</style></head><body>
<h1>${esc(s.title)}</h1>
<p class="sub">End-of-day summary · ${esc(s.date)}</p>
<div class="stats">${s.headline
    .map(([l, v], i) => `<div class="stat${i === 0 ? ' hero' : ''}"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`)
    .join('')}</div>
<ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
${s.sections.map(table).join('\n')}
<footer>Made with Cash Tin</footer>
</body></html>`;
}
