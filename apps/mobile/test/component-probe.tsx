import { createElement, useLayoutEffect, useRef, type ComponentType } from 'react';

// RNTL 14 renders host elements only. Observe committed component boundaries
// through ordinary React composition, not private renderer/fiber internals.
// The original component still renders; effects, children and guards remain real.
const mounted = new WeakMap<object, Map<symbol, unknown>>();

function committedBoundary<Props>(instances: Map<symbol, unknown>, id: symbol): { props: Props } {
  return { get props() {
    if (!instances.has(id)) throw new Error('Test component boundary is no longer mounted.');
    return instances.get(id) as Props;
  } };
}

export function observeComponent<Props extends object>(Component: ComponentType<Props>): ComponentType<Props> {
  const instances = new Map<symbol, unknown>();
  const Observed = jest.fn(function ObservedComponent(props: Props) {
    const identity = useRef(Symbol('test-component-instance'));
    useLayoutEffect(() => {
      const id = identity.current;
      instances.set(id, props);
      return () => { instances.delete(id); };
    });
    return createElement(Component, props);
  });
  mounted.set(Observed, instances);
  return Observed;
}

export function maybeComponent<Props extends object>(Component: ComponentType<Props>): { props: Props } | null {
  const instances = mounted.get(Component);
  if (!instances) throw new Error('Test component boundary must be explicitly observed.');
  if (instances.size > 1) throw new Error('Expected one committed component boundary.');
  if (instances.size === 0) return null;
  return committedBoundary<Props>(instances, instances.keys().next().value!);
}

export function getComponents<Props extends object>(Component: ComponentType<Props>): { props: Props }[] {
  const instances = mounted.get(Component);
  if (!instances) throw new Error('Test component boundary must be explicitly observed.');
  return [...instances.keys()].map(id => committedBoundary<Props>(instances, id));
}

export function getComponent<Props extends object>(Component: ComponentType<Props>): { props: Props } {
  const result = maybeComponent(Component);
  if (!result) throw new Error('Expected component boundary is not mounted.');
  return result;
}
