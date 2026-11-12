import { parseSumupCallback, sumupLink } from '../sumup';

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
      'skip-screen-success': 'true',
      callbacksuccess: 'fetetill://sumup-callback',
      callbackfail: 'fetetill://sumup-callback',
    });
  });

  test('Android: app id, total (with amount for older SumUp apps) and one result link', () => {
    const q = query(sumupLink({ ...base, platform: 'android' }));
    expect(q).toMatchObject({ 'app-id': 'com.fetetill.app', total: '4.50', amount: '4.50', currency: 'GBP', callback: 'fetetill://sumup-callback' });
    expect(q.callbacksuccess).toBeUndefined();
  });

  test('values are escaped, so a title with & or # can’t break the link', () => {
    const q = query(sumupLink({ ...base, platform: 'ios', title: 'Tea & cake #1' }));
    expect(q.title).toBe('Tea & cake #1');
  });
});

describe('the result SumUp sends back', () => {
  test('a success carries SumUp’s transaction code and our payment id', () => {
    expect(parseSumupCallback({ 'smp-status': 'success', 'smp-tx-code': 'TX9', 'foreign-tx-id': 'pay-1' })).toEqual({
      ok: true,
      id: 'pay-1',
      txCode: 'TX9',
      message: 'Card payment taken.',
    });
  });

  test('a failure passes on SumUp’s message', () => {
    expect(parseSumupCallback({ 'smp-status': 'failed', 'smp-message': 'Card declined.', 'foreign-tx-id': 'pay-1' })).toMatchObject({
      ok: false,
      message: 'Card declined.',
    });
  });

  test('anything that isn’t an explicit success counts as not paid', () => {
    expect(parseSumupCallback({}).ok).toBe(false);
    expect(parseSumupCallback({ 'smp-status': 'invalidstate' })).toMatchObject({ ok: false, message: expect.stringMatching(/logged in/) });
    expect(parseSumupCallback({ 'smp-status': ['success', 'failed'] }).ok).toBe(true);
  });
});
