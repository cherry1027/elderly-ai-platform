import { useEffect } from 'react';

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { useLanguage } from '../src/language';
import { PdfPrivacyProvider, usePdfPrivacy, type PdfPrivacyValue } from '../src/exports/PdfPrivacy';
import { createPrivatePdfStore, purgeOwnedPdfCache, type PrivatePdfStore } from '../src/exports/native-pdf';
import { exportCopy } from '../src/exports/export-copy';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../src/language', () => ({ useLanguage: jest.fn() }));
jest.mock('../src/exports/native-pdf', () => ({
  NativePdfError: jest.requireActual('../src/exports/native-pdf').NativePdfError,
  purgeOwnedPdfCache: jest.fn(), createPrivatePdfStore: jest.fn(),
}));
const owner = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000001';
let current!: PdfPrivacyValue;
function Read() {
  const privacy = usePdfPrivacy();
  useEffect(() => { current = privacy; }, [privacy]);
  return <><Text>Ordinary app content</Text><Pressable accessibilityRole="button"><Text>Ordinary navigation</Text></Pressable></>;
}
function tree() { return <PdfPrivacyProvider><Read /></PdfPrivacyProvider>; }
function auth(status = 'signed-in', id: string | null = owner, appActive = true) {
  jest.mocked(useAuth).mockReturnValue({ status, user: id ? { id } : null, appActive } as ReturnType<typeof useAuth>);
}
function language(value: 'en' | 'sv' = 'en') {
  jest.mocked(useLanguage).mockReturnValue({ language: value } as ReturnType<typeof useLanguage>);
}
function store(): jest.Mocked<PrivatePdfStore> {
  return { save: jest.fn(), share: jest.fn(), discard: jest.fn(),
    revoke: jest.fn(async () => {}) };
}
async function flush() { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); }
beforeEach(() => {
  jest.clearAllMocks(); auth(); language();
  jest.mocked(purgeOwnedPdfCache).mockResolvedValue(undefined);
  jest.mocked(createPrivatePdfStore).mockImplementation(() => store());
});
afterEach(cleanup);

it('fails closed outside the provider without touching native files', () => {
  render(<Read />);
  expect(current).toMatchObject({ ready: false, failed: true });
  expect(() => current.createStore(owner)).toThrow();
  current.retry(); current.reportFailure();
  expect(purgeOwnedPdfCache).not.toHaveBeenCalled(); expect(createPrivatePdfStore).not.toHaveBeenCalled();
});

it('shows normal navigation while startup cleanup is pending and blocks PDF capabilities', async () => {
  let finish!: () => void;
  jest.mocked(purgeOwnedPdfCache).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(tree());
  expect(view.getByText('Ordinary app content')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Ordinary navigation' })).not.toBeDisabled();
  expect(current.ready).toBe(false); expect(() => current.createStore(owner)).toThrow();
  expect(createPrivatePdfStore).not.toHaveBeenCalled();
  await waitFor(() => expect(typeof finish).toBe('function'));
  await act(async () => finish()); await waitFor(() => expect(current.ready).toBe(true));
  expect(current.failed).toBe(false);
});

it('creates a registered store only for the currently verified active account', async () => {
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  expect(() => current.createStore(other)).toThrow();
  expect(() => current.createStore('')).toThrow();
  const result = current.createStore(owner);
  expect(result).toBe(jest.mocked(createPrivatePdfStore).mock.results[0].value);
  expect(createPrivatePdfStore).toHaveBeenCalledTimes(1);
});

it.each([
  ['checking', owner, true], ['signed-out', null, true], ['busy', owner, true],
  ['blocked', null, true], ['signed-in', owner, false],
] as const)('blocks capability creation and immediately revokes on %s/%s/%s', async (status, id, active) => {
  const native = store(); jest.mocked(createPrivatePdfStore).mockReturnValue(native);
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  const staleCreate = current.createStore; staleCreate(owner);
  auth(status, id, active); view.rerender(tree());
  expect(native.revoke).toHaveBeenCalledTimes(1);
  expect(() => staleCreate(owner)).toThrow();
  expect(createPrivatePdfStore).toHaveBeenCalledTimes(1); await flush();
});

it('revokes old-account capabilities on account change and never reactivates them', async () => {
  const first = store(), second = store();
  jest.mocked(createPrivatePdfStore).mockReturnValueOnce(first).mockReturnValueOnce(second);
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.createStore(owner);
  auth('signed-in', other); view.rerender(tree());
  expect(first.revoke).toHaveBeenCalledTimes(1);
  expect(() => current.createStore(owner)).toThrow();
  expect(current.createStore(other)).toBe(second);
  auth(); view.rerender(tree());
  expect(second.revoke).toHaveBeenCalledTimes(1); expect(first.revoke).toHaveBeenCalledTimes(1);
  await flush();
});

it('ordinary same-owner rerenders preserve registered handles', async () => {
  const native = store(); jest.mocked(createPrivatePdfStore).mockReturnValue(native);
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.createStore(owner); auth(); view.rerender(tree());
  expect(native.revoke).not.toHaveBeenCalled();
});

it('release revokes the registered capability immediately and ignores unrelated stores', async () => {
  const native = store(), unrelated = store(); jest.mocked(createPrivatePdfStore).mockReturnValue(native);
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  const registered = current.createStore(owner);
  current.release(unrelated); expect(unrelated.revoke).not.toHaveBeenCalled();
  current.release(registered); expect(native.revoke).toHaveBeenCalledTimes(1);
  current.release(registered); expect(native.revoke).toHaveBeenCalledTimes(1); await flush();
});

it('provider unmount revokes every active capability without waiting for native sharing', async () => {
  const first = store(), second = store(); let finish!: () => void;
  first.revoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  jest.mocked(createPrivatePdfStore).mockReturnValueOnce(first).mockReturnValueOnce(second);
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.createStore(owner); current.createStore(owner); const staleCreate = current.createStore;
  view.unmount();
  expect(first.revoke).toHaveBeenCalledTimes(1); expect(second.revoke).toHaveBeenCalledTimes(1);
  expect(() => staleCreate(owner)).toThrow(); await act(async () => finish());
});

it.each(['en', 'sv'] as const)('reports cleanup failures accessibly in %s without hiding ordinary app content', async value => {
  language(value); jest.mocked(purgeOwnedPdfCache).mockRejectedValueOnce(new Error('PRIVATE /cache/document'));
  const view = render(tree()); await waitFor(() => expect(current.failed).toBe(true));
  const warning = view.getByRole('alert');
  expect(warning).toHaveTextContent(exportCopy[value]['cleanup-failed']);
  expect(view.queryByText(/PRIVATE/)).toBeNull();
  expect(view.getByText('Ordinary app content')).toBeTruthy();
  const button = view.getByRole('button', { name: exportCopy[value].cleanupRetry });
  expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(56);
  expect(current.ready).toBe(false); expect(() => current.createStore(owner)).toThrow();
});

it('retries only cleanup, disables duplicate retries and clears warning only after actual success', async () => {
  jest.mocked(purgeOwnedPdfCache).mockRejectedValueOnce(new Error('PRIVATE startup'));
  const view = render(tree()); await waitFor(() => expect(current.failed).toBe(true));
  let finish!: () => void;
  jest.mocked(purgeOwnedPdfCache).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.press(view.getByRole('button', { name: exportCopy.en.cleanupRetry }));
  expect(view.getByRole('button', { name: exportCopy.en.cleanupWorking })).toBeDisabled();
  expect(current.failed).toBe(true); expect(current.ready).toBe(false);
  act(() => { current.retry(); current.retry(); });
  await flush(); expect(purgeOwnedPdfCache).toHaveBeenCalledTimes(2);
  await act(async () => finish()); await waitFor(() => expect(current.ready).toBe(true));
  expect(current.failed).toBe(false); expect(view.queryByRole('alert')).toBeNull();
  expect(createPrivatePdfStore).not.toHaveBeenCalled();
});

it('keeps cleanup blocked when a retry fails', async () => {
  jest.mocked(purgeOwnedPdfCache).mockRejectedValue(new Error('PRIVATE cleanup'));
  const view = render(tree()); await waitFor(() => expect(current.failed).toBe(true));
  fireEvent.press(view.getByRole('button', { name: exportCopy.en.cleanupRetry }));
  await waitFor(() => expect(purgeOwnedPdfCache).toHaveBeenCalledTimes(2));
  await flush(); expect(current.failed).toBe(true); expect(current.ready).toBe(false);
  expect(view.getByRole('button', { name: exportCopy.en.cleanupRetry })).not.toBeDisabled();
});

it('a late controller cleanup report immediately blocks every store and preserves a retry path', async () => {
  const native = store(); jest.mocked(createPrivatePdfStore).mockReturnValue(native);
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.createStore(owner);
  act(() => current.reportFailure());
  expect(native.revoke).toHaveBeenCalledTimes(1); expect(current.failed).toBe(true); expect(current.ready).toBe(false);
  expect(() => current.createStore(owner)).toThrow();
  act(() => current.retry()); await waitFor(() => expect(current.ready).toBe(true));
  expect(current.failed).toBe(false);
});

it('does not clear a new failure reported during an in-flight cleanup', async () => {
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  let finish!: () => void;
  jest.mocked(purgeOwnedPdfCache).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => current.retry()); await flush();
  act(() => current.reportFailure());
  await act(async () => finish()); await flush();
  expect(current.failed).toBe(true); expect(current.ready).toBe(false);
  act(() => current.retry()); await waitFor(() => expect(current.ready).toBe(true));
});

it('converts thrown store-factory and revoke errors to a generic warning', async () => {
  jest.mocked(createPrivatePdfStore).mockImplementationOnce(() => { throw new Error('PRIVATE file path'); });
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  act(() => { expect(() => current.createStore(owner)).toThrow('The private PDF operation could not be completed.'); });
  expect(current.failed).toBe(true); expect(view.queryByText(/PRIVATE/)).toBeNull();
  act(() => current.retry()); await waitFor(() => expect(current.ready).toBe(true));
  const native = store(); native.revoke.mockRejectedValueOnce(new Error('PRIVATE revoke'));
  jest.mocked(createPrivatePdfStore).mockReturnValue(native);
  current.createStore(owner); act(() => current.release(native)); await flush();
  expect(current.failed).toBe(true); expect(current.ready).toBe(false);
});

it('handles a synchronous revoke failure with the same generic fail-closed outcome', async () => {
  const native = store(); native.revoke.mockImplementationOnce(() => { throw new Error('PRIVATE sync'); });
  jest.mocked(createPrivatePdfStore).mockReturnValue(native);
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.createStore(owner); act(() => current.release(native));
  expect(current.failed).toBe(true); expect(current.ready).toBe(false);
});

it('startup cleanup completion after unmount cannot re-enable stale capabilities', async () => {
  let finish!: () => void;
  jest.mocked(purgeOwnedPdfCache).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(tree()), staleCreate = current.createStore;
  await waitFor(() => expect(typeof finish).toBe('function'));
  view.unmount(); await act(async () => finish());
  expect(() => staleCreate(owner)).toThrow(); expect(createPrivatePdfStore).not.toHaveBeenCalled();
});

const project = '30000000-0000-4000-8000-000000000001', draft = '40000000-0000-4000-8000-000000000001';
it('remembers only owner/project/draft IDs and consumes a verified same-owner return once', async () => {
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft);
  const hint = current.consumeReturn(owner);
  expect(hint).toEqual({ projectId: project, draftId: draft });
  expect(Object.keys(hint!).sort()).toEqual(['draftId', 'projectId']);
  expect(current.consumeReturn(owner)).toBeNull();
  expect(createPrivatePdfStore).not.toHaveBeenCalled();
});
it('preserves the same-owner hint through checking and background without granting access', async () => {
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft);
  auth('checking', null, false); view.rerender(tree());
  expect(current.consumeReturn(owner)).toBeNull();
  expect(() => current.rememberReturn(owner, project, draft)).toThrow();
  auth('signed-in', null, false); view.rerender(tree());
  expect(current.consumeReturn(owner)).toBeNull();
  auth(); view.rerender(tree());
  expect(current.consumeReturn(owner)).toEqual({ projectId: project, draftId: draft });
});
it.each(['signed-out', 'blocked'])('clears the return hint after definitive %s', async status => {
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft);
  auth(status, null); view.rerender(tree());
  auth(); view.rerender(tree());
  expect(current.consumeReturn(owner)).toBeNull();
});
it('clears return identity on account change even when the previous account signs in later', async () => {
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft);
  auth('signed-in', other); view.rerender(tree());
  expect(current.consumeReturn(other)).toBeNull();
  auth(); view.rerender(tree());
  expect(current.consumeReturn(owner)).toBeNull();
});
it('rejects invalid return IDs and foreign owners without replacing an existing valid hint', async () => {
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft);
  expect(() => current.rememberReturn(other, project, draft)).toThrow();
  expect(() => current.rememberReturn('private-token', project, draft)).toThrow();
  expect(() => current.rememberReturn(owner, '../private', draft)).toThrow();
  expect(() => current.rememberReturn(owner, project, 'private title')).toThrow();
  expect(current.consumeReturn(other)).toBeNull();
  expect(current.consumeReturn('private-token')).toBeNull();
  expect(current.consumeReturn(owner)).toEqual({ projectId: project, draftId: draft });
});
it('explicit clear removes only the supplied owner return hint', async () => {
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft); current.clearReturn(other);
  expect(current.consumeReturn(owner)).toEqual({ projectId: project, draftId: draft });
  current.rememberReturn(owner, project, draft); current.clearReturn(owner);
  expect(current.consumeReturn(owner)).toBeNull();
});
it('does not retain return identity beyond provider unmount', async () => {
  const view = render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  current.rememberReturn(owner, project, draft);
  const consume = current.consumeReturn, remember = current.rememberReturn;
  view.unmount();
  expect(consume(owner)).toBeNull(); expect(() => remember(owner, project, draft)).toThrow();
  render(tree()); await waitFor(() => expect(current.ready).toBe(true));
  expect(current.consumeReturn(owner)).toBeNull();
});
