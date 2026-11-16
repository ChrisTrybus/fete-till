import { giftAidDonation, readGiftAidRequest } from '../gift-aid';

const sale = {
  createdBy: 'till', total: 600, at: 10, tillName: 'Cake stall', deviceId: 'till-device',
  lines: [{ price: 250, qty: 2, donation: true }, { price: 100, qty: 1 }],
};

test('only the authenticated sale owner can claim its recorded donation', () => {
  expect(giftAidDonation(sale, 'till')).toEqual({ amount: 500, donatedAt: 10, tillName: 'Cake stall', deviceId: 'till-device' });
  expect(giftAidDonation(sale, 'other-till')).toBeNull();
  expect(giftAidDonation({}, 'till')).toBeNull();
  expect(giftAidDonation({ ...sale, total: 400 }, 'till')).toBeNull();
});

test('declaration requests use the donor fields and leave amount and attribution to the server', () => {
  const declaration = { saleId: 'sale', at: 11, firstName: 'Ada', lastName: 'Lovelace', house: '12', postcode: 'SW1A 1AA' };
  expect(readGiftAidRequest({ eventId: 'event', declaration: { ...declaration, amount: 900, createdBy: 'other-till' } }))
    .toEqual({ eventId: 'event', ...declaration });
  expect(readGiftAidRequest({ eventId: 'event', declaration: { ...declaration, postcode: 'unknown' } })).toBeNull();
});
