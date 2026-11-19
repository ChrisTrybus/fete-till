import { recoverOpeningFloat } from '../till-recovery';

const recovered = {
  keyId: 'recovery-binding',
  currentKey: undefined,
  currentSuperseded: false,
  hasBinding: true,
  previousKey: 'recovery-binding',
  moving: true,
  savedFloat: 2000,
};

test('the same recovery binding preserves an opening float under a new UID', () => {
  expect(recoverOpeningFloat(recovered)).toBe(2000);
  expect(recoverOpeningFloat({ ...recovered, pendingFloat: 0 })).toBe(0);
  expect(recoverOpeningFloat({ ...recovered, previousKey: 'different-binding' })).toBeNull();
});

test('an existing UID can recover its own legacy float before it has a binding', () => {
  expect(recoverOpeningFloat({ ...recovered, moving: false, hasBinding: false, previousKey: undefined })).toBe(2000);
});
