import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Only explicit synthetic transports are allowed. Any accidental network call
// fails immediately instead of reaching an authentication or backend service.
const rejectNetwork = () => {
  throw new Error('Network access is blocked in mobile foundation tests.');
};
globalThis.fetch = jest.fn(rejectNetwork);
globalThis.XMLHttpRequest = jest.fn(rejectNetwork) as unknown as typeof XMLHttpRequest;
globalThis.WebSocket = jest.fn(rejectNetwork) as unknown as typeof WebSocket;
