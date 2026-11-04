import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readMobileApiConfig } from '../api/config';
import { listStoryProjects, StoryProjectsError, type StoryProject, type StoryProjectsErrorKind } from '../api/story-projects';
import type { MyStoriesState } from '../screens/MyStoriesScreen';

interface Scope {
  identity: object; owner: string; alive: boolean; attempted: boolean; blocked: boolean; generation: number;
  projects: StoryProject[] | null; request: AbortController | null; lastRequest: AbortController | null;
}
export interface StoryProjectsController {
  state: MyStoriesState;
  refresh(): void;
  invalidate(): void;
  clear(error?: StoryProjectsErrorKind): void;
}
interface Options {
  owner: string; getAccessToken(owner: string): Promise<string | null>; enabled: boolean;
}

/** Saved project rows live only in this mounted, verified account owner. */
export function useStoryProjects({ owner, getAccessToken, enabled }: Options): StoryProjectsController {
  const [config] = useState(readMobileApiConfig);
  const latestToken = useRef(getAccessToken), current = useRef<Scope | null>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ identity: object | null; state: MyStoriesState }>({ identity: null, state: { status: 'loading' } });
  useLayoutEffect(() => { latestToken.current = getAccessToken; }, [getAccessToken]);
  const identity = useMemo(() => ({ owner, baseUrl: config?.baseUrl }), [owner, config]);
  useLayoutEffect(() => {
    const scope: Scope = { identity, owner: identity.owner, alive: true, attempted: false, blocked: false, generation: 0,
      projects: null, request: null, lastRequest: null };
    current.current = scope;
    return () => {
      scope.alive = false; scope.generation++; scope.lastRequest?.abort(); scope.request = null; scope.lastRequest = null; scope.projects = null;
      if (current.current === scope) current.current = null;
    };
  }, [identity]);

  const load = useCallback((force: boolean) => {
    const scope = current.current;
    if (!scope?.alive || scope.owner !== owner || !config || scope.request || scope.blocked || (!force && scope.attempted)) return;
    const controller = new AbortController(), attempt = ++scope.generation;
    scope.lastRequest?.abort(); scope.lastRequest = controller;
    scope.attempted = true; scope.request = controller;
    const isCurrent = () => scope.alive && current.current === scope && scope.generation === attempt && !controller.signal.aborted;
    setResult({ identity: scope.identity, state: scope.projects === null ? { status: 'loading' }
      : { status: 'ready', projects: scope.projects, refreshing: true } });
    void listStoryProjects({ baseUrl: config.baseUrl, getAccessToken: () => latestToken.current(scope.owner), signal: controller.signal })
      .then(projects => {
        if (!isCurrent()) return;
        scope.projects = projects;
        setResult({ identity: scope.identity, state: { status: 'ready', projects } });
      }).catch((error: unknown) => {
        if (!isCurrent()) return;
        const kind = error instanceof StoryProjectsError ? error.kind : 'network';
        if (kind === 'authentication') { scope.projects = null; scope.blocked = true; }
        setResult({ identity: scope.identity, state: scope.projects === null ? { status: 'error', error: kind }
          : { status: 'ready', projects: scope.projects, refreshError: kind } });
      }).finally(() => { if (scope.request === controller) scope.request = null; });
  }, [owner, config]);
  useEffect(() => { if (enabled) load(false); }, [enabled, load, revision]);
  const refresh = useCallback(() => load(true), [load]);
  const invalidate = useCallback(() => {
    const scope = current.current;
    if (!scope?.alive || scope.blocked) return;
    scope.generation++; scope.lastRequest?.abort(); scope.request = null; scope.lastRequest = null; scope.attempted = false;
    setRevision(value => value + 1);
  }, []);
  const clear = useCallback((error?: StoryProjectsErrorKind) => {
    const scope = current.current;
    if (!scope?.alive) return;
    scope.generation++; scope.lastRequest?.abort(); scope.request = null; scope.lastRequest = null; scope.projects = null;
    scope.attempted = !!error; scope.blocked = error === 'authentication';
    setResult({ identity: scope.identity, state: error ? { status: 'error', error } : { status: 'loading' } });
  }, []);
  const state: MyStoriesState = !config ? { status: 'error', error: 'configuration' }
    : result.identity === identity ? result.state : { status: 'loading' };
  return { state, refresh, invalidate, clear };
}
