import { summaryHtml, summaryText } from '../summary';
import type { Sale } from '../types';

const CLOSED = Date.UTC(2026, 5, 20, 15, 0); // 20 June 2026

const sale = (id: string, extra: Partial<Sale> = {}): Sale => ({
  id,
  at: CLOSED - 60 * 60 * 1000,
  total: 230,
  method: 'cash',
  tendered: 500,
  lines: [
    { itemId: 'tea', name: 'Tea', price: 80, qty: 1 },
    { itemId: 'cake', name: 'Slice of cake', price: 150, qty: 1 },
  ],
  tillName: 'Cake stall',
  deviceId: 'd1',
  voided: false,
  ...extra,
});

const tombola = { total: 300, lines: [{ itemId: 't', name: 'Tombola ticket', price: 100, qty: 3 }], tillName: 'Tombola' };

const sales = [
  sale('a'),
  sale('b', { method: 'card', ...tombola }),
  sale('c', { voided: true }),
  sale('d', { at: CLOSED + 5 * 60 * 1000, ...tombola }), // taken on a till that hadn't heard
];

describe('end-of-day summary', () => {
  const text = summaryText({ eventName: 'Summer Fete', sales, closedAt: CLOSED });

  test('gives the headline figures, leaving out voided sales', () => {
    expect(text).toContain('Summer Fete: end-of-day summary');
    expect(text).toContain('June 2026');
    expect(text).toContain('Takings: £8.30');
    expect(text).toContain('Cash: £5.30');
    expect(text).toContain('Card: £3.00');
    expect(text).toContain('Sales: 3');
    expect(text).toContain('1 voided sale (£2.30) not counted.');
  });

  test('breaks the takings down by till and by item', () => {
    expect(text).toContain('Tombola: £6.00 (2)');
    expect(text).toContain('Cake stall: £2.30 (1)');
    expect(text).toContain('Tombola ticket: £6.00 (6)');
    expect(text).toContain('Slice of cake: £1.50 (1)');
  });

  test('says when sales were taken after closing', () => {
    expect(text).toContain('Includes 1 sale (£3.00) taken after the event was closed.');
  });

  test('with floats set, says what each tin should hold', () => {
    const withFloats = summaryText({
      eventName: 'Summer Fete',
      sales,
      closedAt: CLOSED,
      floats: [
        { tillName: 'cake stall', float: 2000 },
        { tillName: 'Plants', float: 1000 },
      ],
    });
    expect(withFloats).toContain('The tins started with £30.00 in floats, so they should hold £35.30 in cash.');
    expect(withFloats).toContain('CASH TO COUNT');
    expect(withFloats).toContain('cake stall: £22.30 (float £20.00)');
    expect(withFloats).toContain('Plants: £10.00 (float £10.00)');
    expect(withFloats).toContain('Tombola: £3.00 (float £0.00)');
    expect(withFloats).toContain('Cash: £5.30'); // the float is not takings
    expect(text).not.toContain('CASH TO COUNT');
  });

  test('says so when the event is still open or some sales are on this phone only', () => {
    const open = summaryText({ eventName: 'Summer Fete', sales, closedAt: null, notShared: 2 });
    expect(open).toContain('still open');
    expect(open).not.toContain('after the event was closed');
    expect(open).toContain('Includes 2 sales held only on the phone that made this summary.');
  });

  test('copes with an event that took nothing', () => {
    const empty = summaryText({ eventName: 'Quiet Fair', sales: [], closedAt: CLOSED });
    expect(empty).toContain('Takings: £0.00');
    expect(empty).not.toContain('BY TILL');
  });

  test('the PDF version carries the same figures and escapes names', () => {
    const html = summaryHtml({
      eventName: 'Fish & <Chips> Fair',
      sales: [sale('a', { tillName: '<script>alert(1)</script>' })],
      closedAt: CLOSED,
    });
    expect(html).toContain('Fish &amp; &lt;Chips&gt; Fair');
    expect(html).not.toContain('<script>');
    expect(html).toContain('£2.30');
    expect(html).toContain('Slice of cake');
  });
});

describe('a past event whose sales cannot be read', () => {
  const input = { eventName: 'Summer Fete', sales: [], closedAt: CLOSED, savedTotals: { takings: 830, cash: 530, card: 300, count: 3 } };

  test('shows the saved totals rather than zeros, and says the detail is missing', () => {
    for (const out of [summaryText(input), summaryHtml(input)]) {
      expect(out).toContain('£8.30');
      expect(out).toContain('£5.30');
      expect(out).toContain('£3.00');
      expect(out).not.toContain('£0.00');
      expect(out).toContain('The individual sales could not be read');
    }
  });
});
