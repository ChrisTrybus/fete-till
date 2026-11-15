/**
 * Starting a shared event goes through the server, which may need an event pack.
 * Firebase is replaced with fakes.
 */
import { createEvent, NeedsPack } from '../cloud';

const mockServerCall = jest.fn();
type AccountUser = { getIdToken: () => Promise<string> } | null;
const accountUser: AccountUser = { getIdToken: async () => 'account-token' };
let mockSignedInAccount: AccountUser = accountUser;

jest.mock('../firebase', () => ({
  ensureSignedIn: async () => 'phone-1',
  getCloud: () => ({ db: {} }),
  getEventFunctions: () => ({}),
  getAccountAuth: () => ({ currentUser: mockSignedInAccount }),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockServerCall }));
jest.mock('firebase/firestore', () => ({ collection: jest.fn(), doc: jest.fn(() => ({ id: 'abcdefghijklmnopqrst' })) }));

const fail = (code: string, reason?: string) =>
  Object.assign(new Error(`failed: ${code}`), { code, details: reason ? { reason } : undefined });
const started = { eventId: 'abcdefghijklmnopqrst', code: 'ABC234', organiserCode: 'QRSTUVWX' };

beforeEach(() => {
  mockServerCall.mockReset();
  mockSignedInAccount = accountUser;
});

it('sends the event, this phone’s details and the account’s token, and returns the codes', async () => {
  mockServerCall.mockResolvedValue({ data: started });
  await expect(createEvent('Fete', 'Cakes', [], 'device-1')).resolves.toEqual(started);
  expect(mockServerCall).toHaveBeenCalledWith({
    eventId: 'abcdefghijklmnopqrst',
    name: 'Fete',
    tillName: 'Cakes',
    items: [],
    deviceId: 'device-1',
    accountToken: 'account-token',
  });
});

it('sends no token when nobody is signed in', async () => {
  mockSignedInAccount = null;
  mockServerCall.mockResolvedValue({ data: started });
  await createEvent('Fete', 'Cakes', []);
  expect(mockServerCall.mock.calls[0][0]).toMatchObject({ accountToken: null, deviceId: null });
});

it('says when a pack, or signing in, is needed', async () => {
  mockServerCall.mockRejectedValue(fail('functions/failed-precondition', 'no-credits'));
  const e = await createEvent('Fete', 'Cakes', []).catch((x) => x);
  expect(e).toBeInstanceOf(NeedsPack);
  expect(e.reason).toBe('no-credits');

  mockServerCall.mockRejectedValue(fail('functions/failed-precondition', 'sign-in'));
  await expect(createEvent('Fete', 'Cakes', [])).rejects.toMatchObject({ reason: 'sign-in' });
  expect(mockServerCall).toHaveBeenCalledTimes(2); // neither is retried
});

it('tries once more with the same event id after a lost reply, so no second credit is spent', async () => {
  mockServerCall.mockRejectedValueOnce(fail('functions/deadline-exceeded')).mockResolvedValueOnce({ data: started });
  await createEvent('Fete', 'Cakes', []);
  expect(mockServerCall).toHaveBeenCalledTimes(2);
  expect(mockServerCall.mock.calls[1][0].eventId).toBe(mockServerCall.mock.calls[0][0].eventId);
});

it('gives up with "timeout" after the second failure', async () => {
  mockServerCall.mockRejectedValue(fail('functions/unavailable'));
  await expect(createEvent('Fete', 'Cakes', [])).rejects.toThrow('timeout');
  expect(mockServerCall).toHaveBeenCalledTimes(2);
});
