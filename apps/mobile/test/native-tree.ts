import { fireEvent, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import type { Ref } from 'react';
import type { LayoutChangeEvent } from 'react-native';

// Observe public native component boundaries only where a native prop/ref
// contract cannot be represented by their rendered host-node output.
jest.mock('react-native', () => {
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  const observed = {
    Text: observeComponent(actual.Text), TextInput: observeComponent(actual.TextInput),
    KeyboardAvoidingView: observeComponent(actual.KeyboardAvoidingView),
    Pressable: observeComponent(actual.Pressable),
  };
  const descriptors = Object.getOwnPropertyDescriptors(actual);
  for (const [name, component] of Object.entries(observed)) descriptors[name] = { value: component, enumerable: true, configurable: true, writable: true };
  return Object.create(Object.getPrototypeOf(actual), descriptors);
});

// Deliberately inspect only public host nodes for native layout/style contracts.
// Component props and callbacks are observed separately through React wrappers.
const nativeKinds = {
  text: ['Text', 'RCTText'],
  input: ['TextInput'],
  scroll: ['RCTScrollView'],
  view: ['View', 'RCTView'],
  modal: ['Modal'],
  path: ['RNSVGPath'],
  svgGroup: ['RNSVGGroup'],
  rect: ['RNSVGRect'],
  svgText: ['RNSVGText'],
} as const;

export function nativeNodes(kind: keyof typeof nativeKinds): TestInstance[] {
  const names: readonly string[] = nativeKinds[kind];
  return screen.container.queryAll(node => names.includes(node.type));
}

export function nativeNode(kind: keyof typeof nativeKinds): TestInstance {
  const nodes = nativeNodes(kind);
  if (nodes.length !== 1) throw new Error(`Expected one native ${kind} node, found ${nodes.length}.`);
  return nodes[0];
}

export function nativeRef<T>(ref: Ref<T> | undefined): T {
  if (!ref || typeof ref === 'function' || !ref.current) throw new Error('Expected a mounted native object ref.');
  return ref.current;
}

export function nativeText(node: TestInstance): string {
  const content = node.type === 'RNSVGTSpan' && typeof node.props.content === 'string' ? node.props.content : '';
  return content + node.children.map(child => typeof child === 'string' ? child : nativeText(child)).join('');
}

export async function contentLayout(callback: ((event: LayoutChangeEvent) => void) | undefined, y = 0) {
  const nodes = screen.container.queryAll(node => !!callback && node.props.onLayout === callback);
  if (nodes.length !== 1) throw new Error('Expected the actual native content-layout boundary.');
  await fireEvent(nodes[0], 'layout', { nativeEvent: { layout: { x: 0, y, width: 342, height: 800 } } });
}
