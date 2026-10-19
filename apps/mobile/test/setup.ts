import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

// The application has no transport. Any accidental browser-style network call
// fails immediately instead of reaching an authentication or backend service.
const rejectNetwork = () => {
  throw new Error('Network access is blocked in mobile foundation tests.');
};
globalThis.fetch = jest.fn(rejectNetwork);
globalThis.XMLHttpRequest = jest.fn(rejectNetwork) as unknown as typeof XMLHttpRequest;
globalThis.WebSocket = jest.fn(rejectNetwork) as unknown as typeof WebSocket;
