import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('react-native-safe-area-context', () => {
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  const actual = jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');
  return { ...actual, ...mockSafeAreaContext, SafeAreaView: observeComponent(actual.SafeAreaView) };
});

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
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(() => { throw new Error('Native digest must be explicitly mocked in tests.'); }),
  randomUUID: jest.fn(() => { throw new Error('Native randomness must be mocked in tests.'); }),
}));

// Default foundation tests have an empty synthetic PDF cache. Real native
// storage/sharing stays blocked; dedicated adapter tests unmock and inject it.
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => { throw new Error('Native sharing is blocked in tests.'); }),
}));
jest.mock('../src/exports/native-pdf', () => ({
  ...jest.requireActual('../src/exports/native-pdf'),
  purgeOwnedPdfCache: jest.fn(async () => {}),
  createPrivatePdfStore: jest.fn(() => { throw new Error('Native PDF storage must be explicitly mocked.'); }),
}));
