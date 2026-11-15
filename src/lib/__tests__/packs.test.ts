/**
 * Event packs on the phone: buying through the store, then having the server count it.
 * The store (RevenueCat) and the server are replaced with fakes.
 */
import * as Functions from 'firebase/functions';
import * as StorePurchases from '../store-purchases';
import { buyPack, readCredits, syncPurchases } from '../packs';

const accountAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'acct-1' } };
const mockServerCall = jest.fn();

jest.mock('../firebase', () => ({
  getAccountAuth: () => accountAuth,
  getAccountCloud: () => ({ functions: {}, db: {} }),
}));
jest.mock('../store-purchases', () => ({
  purchasesAvailable: true,
  buyProduct: jest.fn(),
  storePrices: jest.fn(async () => ({})),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockServerCall) }));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), onSnapshot: jest.fn() }));

const store = jest.mocked(StorePurchases);

beforeEach(() => {
  jest.clearAllMocks();
  accountAuth.currentUser = { uid: 'acct-1' };
  mockServerCall.mockResolvedValue({ data: { credits: 5, unlocked: true, added: 5 } });
});

describe('readCredits', () => {
  it('reads what the server stored, treating anything odd as none', () => {
    expect(readCredits({ credits: 4, unlocked: true })).toEqual({ credits: 4, unlocked: true });
    expect(readCredits(undefined)).toEqual({ credits: 0, unlocked: false });
    expect(readCredits({ credits: -2, unlocked: 'yes' })).toEqual({ credits: 0, unlocked: false });
  });
});

describe('buyPack', () => {
  it('buys for the signed-in account, then has the server count it', async () => {
    store.buyProduct.mockResolvedValue(true);
    await expect(buyPack('cashtin_event_5')).resolves.toBe('counted');
    expect(store.buyProduct).toHaveBeenCalledWith('acct-1', 'cashtin_event_5');
    expect(jest.mocked(Functions.httpsCallable)).toHaveBeenCalledWith({}, 'syncPurchases', expect.anything());
    expect(mockServerCall).toHaveBeenCalled();
  });

  it('does nothing more when the person cancels in the store', async () => {
    store.buyProduct.mockResolvedValue(false);
    await expect(buyPack('cashtin_event_1')).resolves.toBe('cancelled');
    expect(mockServerCall).not.toHaveBeenCalled();
  });

  it('says it was paid for when the server can’t be reached to count it', async () => {
    store.buyProduct.mockResolvedValue(true);
    mockServerCall.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }));
    await expect(buyPack('cashtin_event_1')).resolves.toBe('paid');
  });

  it('needs an account', async () => {
    accountAuth.currentUser = null;
    await expect(buyPack('cashtin_event_1')).rejects.toThrow('Sign in');
    await expect(syncPurchases()).rejects.toThrow('Sign in');
    expect(store.buyProduct).not.toHaveBeenCalled();
  });
});
