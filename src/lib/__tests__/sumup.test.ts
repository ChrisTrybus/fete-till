import { sumupLink } from '../sumup';

const base = { affiliateKey: 'key-123', appId: 'com.fetetill.app', total: 450, title: 'Summer Fete · Cake stall', id: 'pay-1', callback: 'fetetill://sumup-callback' };
const query = (url: string) => Object.fromEntries(new URL(url.replace('sumupmerchant://', 'https://x/')).searchParams);

describe('opening the SumUp app', () => {
  test('iOS: amount in pounds, GBP, result links for success and failure', () => {
    const url = sumupLink({ ...base, platform: 'ios' });
    expect(url.startsWith('sumupmerchant://pay/1.0?')).toBe(true);
    expect(query(url)).toEqual({
      'affiliate-key': 'key-123',
      amount: '4.50',
      currency: 'GBP',
      title: 'Summer Fete · Cake stall',
      'foreign-tx-id': 'pay-1',
      callbacksuccess: 'fetetill://sumup-callback',
      callbackfail: 'fetetill://sumup-callback',
    });
  });

  test('Android: app id, total (with amount for older SumUp apps) and one result link', () => {
    const q = query(sumupLink({ ...base, platform: 'android' }));
    expect(q).toMatchObject({ 'app-id': 'com.fetetill.app', total: '4.50', amount: '4.50', currency: 'GBP', callback: 'fetetill://sumup-callback' });
    expect(q.callbacksuccess).toBeUndefined();
    expect(q['skip-screen-success']).toBeUndefined();
  });

  test('values are escaped, so a title with & or # can’t break the link', () => {
    const q = query(sumupLink({ ...base, platform: 'ios', title: 'Tea & cake #1' }));
    expect(q.title).toBe('Tea & cake #1');
  });
});
