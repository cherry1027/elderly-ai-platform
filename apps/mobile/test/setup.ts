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

jest.mock('expo-audio', () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false })),
    AudioRecorder: jest.fn(() => { throw new Error('Native recording is blocked in tests.'); }),
  },
  RecordingPresets: { HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100,
    numberOfChannels: 2, bitRate: 128000, ios: {}, android: {} } },
  setAudioModeAsync: jest.fn(async () => { throw new Error('Native audio is blocked in tests.'); }),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///blocked-test-cache/' } },
  File: jest.fn(() => { throw new Error('Native recording files are blocked in tests.'); }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => { throw new Error('Native randomness must be mocked in tests.'); }),
}));
