import { createRef, startTransition, Suspense, useImperativeHandle, useState, type Ref } from 'react';
import { Text, TextInput } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { getComponent, getComponents, maybeComponent, observeComponent } from './component-probe';

test('observes committed props while retaining real rendering and mock-call assertions', async () => {
  const Boundary = observeComponent(({ value }: { value: string }) => <Text>{value}</Text>);
  const view = await render(<Boundary value="first synthetic value" />);
  expect(screen.getByText('first synthetic value')).toBeOnTheScreen();
  expect(getComponent(Boundary).props.value).toBe('first synthetic value');
  const committed = getComponent(Boundary);
  const captured = committed.props;
  expect(Boundary).toHaveBeenCalled();
  await view.rerender(<Boundary value="second synthetic value" />);
  expect(getComponent(Boundary).props.value).toBe('second synthetic value');
  expect(committed.props.value).toBe('second synthetic value');
  expect(captured.value).toBe('first synthetic value');
  await view.unmount();
  expect(maybeComponent(Boundary)).toBeNull();
  expect(() => committed.props).toThrow('no longer mounted');
});

test('distinguishes multiple mounted boundaries and removes only the unmounted instance', async () => {
  const Boundary = observeComponent(({ id }: { id: number }) => <Text>{id}</Text>);
  const view = await render(<><Boundary key="one" id={1} /><Boundary key="two" id={2} /></>);
  expect(getComponents(Boundary).map(node => node.props.id)).toEqual([1, 2]);
  expect(() => getComponent(Boundary)).toThrow('Expected one committed component boundary.');
  await view.rerender(<><Boundary key="two" id={2} /></>);
  expect(getComponent(Boundary).props.id).toBe(2);
  await view.unmount();
  expect(getComponents(Boundary)).toEqual([]);
});

test('preserves React 19 ref props through an observed native boundary', async () => {
  const Boundary = observeComponent(TextInput);
  const ref = createRef<React.ComponentRef<typeof TextInput>>();
  const view = await render(<Boundary ref={ref} accessibilityLabel="Synthetic input" value="safe" />);
  expect(getComponent(Boundary).props.ref).toBe(ref);
  expect(screen.getByLabelText('Synthetic input')).toBeOnTheScreen();
  await view.unmount();
});

test('fails explicitly for an unobserved or unmounted boundary', () => {
  const Plain = () => <Text>plain</Text>;
  expect(() => maybeComponent(Plain)).toThrow('must be explicitly observed');
  expect(() => getComponent(observeComponent(Plain))).toThrow('not mounted');
});

test('forwards a functioning imperative ref and clears it on unmount', async () => {
  const focus = jest.fn();
  const Boundary = observeComponent(({ ref }: { ref?: Ref<{ focus(): void }> }) => {
    useImperativeHandle(ref, () => ({ focus }), []);
    return <Text>Synthetic imperative boundary</Text>;
  });
  const ref = createRef<{ focus(): void }>();
  const view = await render(<Boundary ref={ref} />);
  expect(ref.current).not.toBeNull();
  ref.current!.focus();
  expect(focus).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(ref.current).toBeNull();
  expect(maybeComponent(Boundary)).toBeNull();
});

test('keeps only committed props when a suspended transition is superseded', async () => {
  const pending = new Promise<never>(() => {});
  let change!: (value: string) => void;
  const Boundary = observeComponent(({ value }: { value: string }) => {
    if (value === 'pending') throw pending;
    return <Text>{value}</Text>;
  });
  function Root() {
    const [value, setValue] = useState('committed');
    change = setValue;
    return <Suspense fallback={<Text>Loading boundary</Text>}><Boundary value={value} /></Suspense>;
  }
  const view = await render(<Root />);
  const boundary = getComponent(Boundary);
  await act(() => startTransition(() => change('pending')));
  expect(boundary.props.value).toBe('committed');
  expect(screen.getByText('committed')).toBeOnTheScreen();
  await act(() => change('replacement'));
  expect(boundary.props.value).toBe('replacement');
  expect(screen.getByText('replacement')).toBeOnTheScreen();
  await view.unmount();
});
