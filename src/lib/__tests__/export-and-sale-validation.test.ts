import { csvCell } from '../csv';
import { isSaleRecord } from '../sale-record';

test('CSV keeps formula-like text literal and doubles embedded quotes', () => {
  expect(csvCell('  =1+1')).toBe('"’  =1+1"');
  expect(csvCell('＋1')).toBe('"’＋1"');
  expect(csvCell('Cake, "large"')).toBe('"Cake, ""large"""');
  expect(csvCell('5.00')).toBe('"5.00"');
});

test('only well-formed sale records reach reporting', () => {
  const sale = {
    id: 'sale', at: 1, total: 200, tendered: 200, method: 'cash', tillName: 'Cake stall', deviceId: 'till',
    voided: false, lines: [{ itemId: 'cake', name: 'Cake', price: 200, qty: 1 }],
  };
  expect(isSaleRecord(sale)).toBe(true);
  expect(isSaleRecord({ ...sale, lines: {} })).toBe(false);
  expect(isSaleRecord({ ...sale, lines: [null] })).toBe(false);
  expect(isSaleRecord({ ...sale, at: Number.MAX_SAFE_INTEGER })).toBe(false);
});
