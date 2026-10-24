import { render, cleanup } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import { useAuth } from '../src/auth/AuthProvider';
import { createGenerationActionId, createGenerationStore, GenerationActionsProvider, useGenerationActions,
  type GenerationStore, type GenerationAction } from '../src/generation/GenerationActions';
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: jest.fn() }));
const action: GenerationAction = { key: '10000000-0000-4000-8000-000000000001',
  input: { language: 'en', style: 'warm', confirm_generation: true } };
afterEach(cleanup);
it('isolates owners and copies/freezes action metadata without prose or tokens', () => {
  const store = createGenerationStore('a'); const original = { ...action, input: { ...action.input } };
  expect(store.set('b', 'story', original)).toBe(false);
  expect(store.set('a', 'story', original)).toBe(true);
  original.input.language = 'sv';
  expect(store.get('a', 'story')).toEqual(action);
  expect(Object.isFrozen(store.get('a', 'story'))).toBe(true);
  expect(Object.isFrozen(store.get('a', 'story')?.input)).toBe(true);
  expect(store.get('b', 'story')).toBeUndefined();
  store.activate('b'); expect(store.get('a', 'story')).toBeUndefined();
  expect(store.get('b', 'story')).toBeUndefined();
});
it('explicit removal and full cleanup retain no retry action', () => {
  const store = createGenerationStore('a'); store.set('a', 'one', action); store.set('a', 'two', action);
  store.remove('b', 'one'); expect(store.get('a', 'one')).toEqual(action);
  store.remove('a', 'one'); expect(store.get('a', 'one')).toBeUndefined();
  store.clear(); expect(store.get('a', 'two')).toBeUndefined();
  expect(store.set('a', 'one', action)).toBe(false);
});
it('keeps selected UUIDs separate from pending generation actions and bounds RAM-only navigation hints', () => {
  const store = createGenerationStore('a'), id = '10000000-0000-4000-8000-000000000001';
  expect(store.select('b', 'project', id)).toBe(false);
  expect(store.select('a', 'project', 'private text')).toBe(false);
  expect(store.select('a', 'project', id)).toBe(true);
  expect(store.getSelection('b', 'project')).toBeUndefined();
  store.set('a', 'project', action); store.remove('a', 'project');
  expect(store.getSelection('a', 'project')).toBe(id);
  for (let n = 0; n < 200; n++) store.select('a', 'story-' + n, id);
  expect(store.getSelection('a', 'project')).toBeUndefined();
  expect(store.getSelection('a', 'story-199')).toBe(id);
  store.activate('b'); expect(store.getSelection('b', 'story-199')).toBeUndefined();
  store.select('b', 'new', id); store.clear(); expect(store.getSelection('b', 'new')).toBeUndefined();
});
it('provider survives checking/background with same verified owner, and clears when owner changes', async () => {
  let store!: GenerationStore;
  const snapshot = (status: string, id?: string) => jest.mocked(useAuth).mockReturnValue({
    status, user: id ? { id } : null, appActive: status !== 'checking',
  } as ReturnType<typeof useAuth>);
  function Read({ owner }: { owner: string }) { store = useGenerationActions(owner); return null; }
  snapshot('signed-in', 'a');
  const view = await render(<GenerationActionsProvider><Read owner="a" /></GenerationActionsProvider>);
  store.set('a', 'story', action);
  store.select('a', 'story', action.key);
  snapshot('checking'); await view.rerender(<GenerationActionsProvider><Read owner="a" /></GenerationActionsProvider>);
  expect(store.get('a', 'story')).toEqual(action);
  expect(store.getSelection('a', 'story')).toBe(action.key);
  snapshot('signed-in', 'a'); await view.rerender(<GenerationActionsProvider><Read owner="a" /></GenerationActionsProvider>);
  expect(store.get('a', 'story')).toEqual(action);
  snapshot('signed-in', 'b'); await view.rerender(<GenerationActionsProvider><Read owner="b" /></GenerationActionsProvider>);
  expect(store.get('a', 'story')).toBeUndefined();
  expect(store.get('b', 'story')).toBeUndefined();
  expect(store.getSelection('b', 'story')).toBeUndefined();
});
it.each(['signed-out', 'blocked', 'busy'])('provider clears after %s', async status => {
  let store!: GenerationStore;
  function Read() { store = useGenerationActions('a'); return null; }
  jest.mocked(useAuth).mockReturnValue({ status: 'signed-in', user: { id: 'a' } } as ReturnType<typeof useAuth>);
  const view = await render(<GenerationActionsProvider><Read /></GenerationActionsProvider>);
  store.set('a', 'story', action);
  store.select('a', 'story', action.key);
  jest.mocked(useAuth).mockReturnValue({ status, user: null } as ReturnType<typeof useAuth>);
  await view.rerender(<GenerationActionsProvider><Read /></GenerationActionsProvider>);
  expect(store.get('a', 'story')).toBeUndefined();
  expect(store.getSelection('a', 'story')).toBeUndefined();
});
it('uses native secure UUID randomness without reusing other action identities', () => {
  jest.mocked(Crypto.randomUUID).mockReturnValueOnce(action.key as ReturnType<typeof Crypto.randomUUID>);
  expect(createGenerationActionId()).toBe(action.key);
});
it.each(['not-a-uuid', '', '10000000-0000-1000-8000-000000000001'])('refuses invalid native UUID %s', key => {
  jest.mocked(Crypto.randomUUID).mockReturnValueOnce(key as ReturnType<typeof Crypto.randomUUID>);
  expect(createGenerationActionId).toThrow('Secure generation identity is unavailable.');
});
