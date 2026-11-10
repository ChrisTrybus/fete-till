// Security rules tests run in plain Node against the Firestore emulator, not in
// the React Native test environment. Run with `npm run test:rules`.
module.exports = {
  preset: 'jest-expo/node',
  roots: ['<rootDir>/tests/rules'],
  testTimeout: 20000,
};
