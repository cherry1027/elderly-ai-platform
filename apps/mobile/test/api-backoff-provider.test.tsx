import { act, cleanup, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AccessibilityInfo, AppState, Pressable, Text } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { useLanguage } from '../src/language';
import { readMobileApiConfig } from '../src/api/config';
import { ApiBackoffBanner, ApiBackoffProvider, useApiBackoff, type ApiBackoffValue } from '../src/api/ApiBackoff';
import { apiBackoff, parseRetryAdvice } from '../src/api/backoff';
import { Screen } from '../src/components/Screen';

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../src/language', () => ({ useLanguage: jest.fn() }));
jest.mock('../src/api/config', () => ({ readMobileApiConfig: jest.fn() }));
const origin = 'http://192.168.1.30:8000', owner = '10000000-0000-4000-8000-000000000001';
let current: ApiBackoffValue, onState: (state: string) => void;
const send = jest.fn();
function Probe({ page = 'one' }: { page?: string }) {
  const value = useApiBackoff();
  useEffect(() => { current = value; }, [value]);
  return <><ApiBackoffBanner /><Text>{page}</Text><Pressable accessibilityRole="button" accessibilityLabel="Try action"
    accessibilityState={{ disabled: value.waiting }} disabled={value.waiting} onPress={send}><Text>Try action</Text></Pressable></>;
}
function tree(page?: string) { return <ApiBackoffProvider><Probe key={page} page={page} /></ApiBackoffProvider>; }
function auth(status = 'signed-in', id: string | null = owner, appActive = true) {
  jest.mocked(useAuth).mockReturnValue({ status, user: id ? { id } : null, appActive } as ReturnType<typeof useAuth>);
}
function language(value: 'en' | 'sv' = 'en') {
  jest.mocked(useLanguage).mockReturnValue({ language: value } as ReturnType<typeof useLanguage>);
}
async function admission(seconds = '10') {
  await act(() => { apiBackoff.capture().record(origin, parseRetryAdvice(429, 'RATE_LIMITED', seconds)!); });
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(1_000_000); apiBackoff.clear(); jest.clearAllMocks(); auth(); language();
  jest.mocked(readMobileApiConfig).mockReturnValue({ baseUrl: origin });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    onState = handler as (state: string) => void; return { remove: jest.fn() };
  });
  jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => {});
});
afterEach(async () => { await cleanup(); apiBackoff.clear(); jest.restoreAllMocks(); jest.useRealTimers(); });

it('keeps ordinary Screen usable outside optional provider without authentication or configuration', async () => {
  await render(<Screen><Text>Local content</Text></Screen>);
  expect(current?.waiting ?? false).toBe(false); expect(useAuth).not.toHaveBeenCalled();
});
it('shows English wait metadata and disables explicit requests while retaining page content', async () => {
  const view = await render(tree()); await admission();
  expect(view.getByText(/Memy needs a short wait/)).toBeTruthy(); expect(view.getByText('The service requested a pause of 10 seconds.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Try action' })).toBeDisabled(); expect(view.getByText('one')).toBeTruthy();
  expect(current.waiting).toBe(true); expect(send).not.toHaveBeenCalled();
});
it('shows Swedish wait and explicit-action expiry copy', async () => {
  language('sv'); const view = await render(tree()); await admission('2');
  expect(view.getByText(/Memy behöver en kort paus/)).toBeTruthy(); expect(view.getByText('Tjänsten begärde en paus på 2 sekunder.')).toBeTruthy();
  await act(() => jest.advanceTimersByTime(2000));
  expect(view.getByText(/Du kan försöka igen nu/)).toBeTruthy(); expect(current.waiting).toBe(false); expect(send).not.toHaveBeenCalled();
});
it('announces once on waiting and once at expiry, without ticking announcements or automatic requests', async () => {
  const view = await render(tree()); await admission('10');
  expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(9000));
  expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(1);
  await act(() => jest.advanceTimersByTime(1000));
  expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(2);
  expect(view.getByRole('button', { name: 'Try action' })).not.toBeDisabled(); expect(send).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('retains wait through screen remount and does not repeat the announcement', async () => {
  const view = await render(tree('one')); await admission(); const deadline = current.advice?.retryAt;
  await view.rerender(tree('two')); expect(current.waiting).toBe(true); expect(current.advice?.retryAt).toBe(deadline);
  expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
});
it('retains same-owner deadline through hidden background and temporary checking', async () => {
  const view = await render(tree()); await admission(); const deadline = current.advice?.retryAt;
  auth('checking', null, false); await view.rerender(tree());
  expect(current.waiting).toBe(true); expect(view.queryByTestId('api-backoff-banner')).toBeNull();
  auth(); await view.rerender(tree());
  expect(current.advice?.retryAt).toBe(deadline); expect(current.waiting).toBe(true); expect(send).not.toHaveBeenCalled();
});
it('uses elapsed foreground wall-clock time without replaying a request', async () => {
  const view = await render(tree()); await admission();
  auth('checking', null, false); await view.rerender(tree());
  jest.setSystemTime(1_030_000);
  await act(() => onState('active')); auth(); await view.rerender(tree());
  expect(current.waiting).toBe(false); expect(view.getByText(/You can try again now/)).toBeTruthy(); expect(send).not.toHaveBeenCalled();
});
it('rearms expiry after the wall clock moves backward instead of leaving controls disabled', async () => {
  const view = await render(tree()); await admission('10');
  jest.setSystemTime(990_000);
  await act(() => jest.advanceTimersByTime(10_000));
  expect(current.waiting).toBe(true);
  await act(() => jest.advanceTimersByTime(10_000));
  expect(current.waiting).toBe(false); expect(view.getByText(/You can try again now/)).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});
it('rearms a future deadline on foreground after the wall clock moves backward', async () => {
  await render(tree()); await admission('10');
  jest.setSystemTime(995_000); await act(() => onState('active'));
  await act(() => jest.advanceTimersByTime(14_999)); expect(current.waiting).toBe(true);
  await act(() => jest.advanceTimersByTime(1)); expect(current.waiting).toBe(false); expect(send).not.toHaveBeenCalled();
});
it.each(['signed-out', 'blocked', 'busy'])('clears cooldown and revokes old response scope on %s', async status => {
  const view = await render(tree()); await admission(); const stale = apiBackoff.capture();
  auth(status, null); await view.rerender(tree());
  expect(stale.isCurrent()).toBe(false); expect(current.waiting).toBe(false); expect(view.queryByTestId('api-backoff-banner')).toBeNull();
  auth(); await view.rerender(tree()); expect(view.queryByTestId('api-backoff-banner')).toBeNull();
});
it('does not show an expired old-owner banner on direct account replacement', async () => {
  const view = await render(tree()); await admission(); const stale = apiBackoff.capture();
  auth('signed-in', '20000000-0000-4000-8000-000000000001'); await view.rerender(tree());
  expect(stale.isCurrent()).toBe(false); expect(current.waiting).toBe(false); expect(current.expired).toBe(false);
  expect(view.queryByTestId('api-backoff-banner')).toBeNull();
});
it('does not show another API origin’s wait', async () => {
  const view = await render(tree());
  await act(() => apiBackoff.capture().record('http://192.168.1.31:8000', parseRetryAdvice(429, 'RATE_LIMITED', '10')!));
  expect(current.waiting).toBe(false); expect(view.queryByTestId('api-backoff-banner')).toBeNull();
});
it('clears all process-local scope on provider unmount', async () => {
  const view = await render(tree()); await admission(); const lease = apiBackoff.capture(); await view.unmount();
  expect(lease.isCurrent()).toBe(false); expect(apiBackoff.getAdvice(origin)).toBeUndefined();
});
