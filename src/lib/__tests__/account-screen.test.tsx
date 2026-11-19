/**
 * The Account screen's event packs card, for a signed-in account.
 * The account, the server and the store are replaced with fakes.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AccountScreen from '../../app/account';
import * as Packs from '../packs';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('../store', () => ({ useStore: () => ({ cloudEnabled: true }) }));
jest.mock('../../components/apple-button', () => ({ AppleButton: () => null }));
jest.mock('../account', () => ({
  MIN_PASSWORD: 8,
  availableProviders: async () => [],
  useAccount: () => ({
    ready: true,
    account: { uid: 'acct-1', email: 'sam@example.com', name: null, emailVerified: true, methods: ['password'] },
  }),
}));
jest.mock('../packs', () => ({
  PACKS: [
    { id: 'cashtin_event_1', events: 1, fallbackPrice: '£0.99' },
    { id: 'cashtin_event_5', events: 5, fallbackPrice: '£2.99' },
  ],
  purchasesAvailable: true,
  useCredits: jest.fn(() => ({ credits: 3, unlocked: true })),
  packPrices: jest.fn(async () => ({ cashtin_event_1: '£0.99', cashtin_event_5: '£2.99' })),
  syncPurchases: jest.fn(async () => ({ credits: 3, unlocked: true, added: 0 })),
  buyPack: jest.fn(async () => 'counted'),
}));

const packs = jest.mocked(Packs);
jest.setTimeout(30000); // the first render loads the whole screen

it('shows the events left and the packs at the store’s prices, and buys one', async () => {
  await render(<AccountScreen />);
  await act(async () => {});
  expect(screen.getByText('3 events left')).toBeTruthy();
  expect(packs.syncPurchases).toHaveBeenCalled(); // counts anything bought earlier with no signal

  await act(async () => fireEvent.press(screen.getByText('5 events · £2.99')));
  expect(packs.buyPack).toHaveBeenCalledWith('cashtin_event_5');
  expect(screen.getByText('Added 5 events to your account.')).toBeTruthy();
});

it('says when a purchase is waiting to be counted', async () => {
  packs.buyPack.mockResolvedValueOnce('paid');
  await render(<AccountScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByText('1 event · £0.99')));
  expect(screen.getByText(/Your purchase went through/)).toBeTruthy();
});
