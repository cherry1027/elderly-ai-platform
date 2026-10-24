import { getComponents } from './component-probe';
import { nativeNode } from './native-tree';
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Pressable, Text, type AppStateStatus } from 'react-native';
import { leaveCopy, useGuardedLeave, type LeaveHandle } from '../src/navigation/useGuardedLeave';
import { AccountAction } from '../src/components/AccountPresentation';
import type { Language } from '../src/i18n';

jest.mock('../src/components/AccountPresentation', () => {
  const actual = jest.requireActual<typeof import('../src/components/AccountPresentation')>('../src/components/AccountPresentation');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, AccountAction: observeComponent(actual.AccountAction) };
});

function Harness({ language='en', dirty=true, uncertain=false, checkDisabled=false, handle, leave, discard, check }: {
  language?:Language;dirty?:boolean;uncertain?:boolean;checkDisabled?:boolean;handle:ReturnType<typeof createRef<LeaveHandle>>;
  leave:()=>void;discard?:()=>void;check?:()=>void;
}) {
  const guard=useGuardedLeave({language,dirty,uncertain,checkDisabled,handleRef:handle,onDiscard:discard,onCheckSavedResult:check});
  return <><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>guard.requestLeave(leave)}><Text>Back</Text></Pressable>{guard.dialog}</>;
}
const callback=(label:string)=>getComponents(AccountAction).find(item=>item.props.label===label)!.props.onPress;
afterEach(()=>{jest.restoreAllMocks();expect(globalThis.fetch).not.toHaveBeenCalled();});
it.each<Language>(['en','sv'])('%s dirty form stays intact or explicitly discards once, including the hardware intent handle',async language=>{
  const handle=createRef<LeaveHandle>(),leave=jest.fn(),discard=jest.fn(),text=leaveCopy[language];
  await render(<Harness language={language} handle={handle} leave={leave} discard={discard}/>);
  await fireEvent.press(screen.getByRole('button',{name:'Back'}));
  expect(screen.getByText(text.dirty)).toBeOnTheScreen();expect(leave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button',{name:text.keep}));expect(discard).not.toHaveBeenCalled();
  await act(()=>handle.current?.requestLeave(leave));
  const stale=callback(text.discard);
  await fireEvent.press(screen.getByRole('button',{name:text.discard}));
  await act(()=>stale());expect(discard).toHaveBeenCalledTimes(1);expect(leave).toHaveBeenCalledTimes(1);
});
it('clean forms leave immediately without a warning or discard',async ()=>{
  const handle=createRef<LeaveHandle>(),leave=jest.fn(),discard=jest.fn();
  await render(<Harness dirty={false} handle={handle} leave={leave} discard={discard}/>);
  await fireEvent.press(screen.getByRole('button',{name:'Back'}));expect(leave).toHaveBeenCalledTimes(1);
  expect(discard).not.toHaveBeenCalled();expect(screen.queryByText(leaveCopy.en.title)).toBeNull();
});
it('does not accept navigation when mounted while the app is already in the background',async ()=>{
  const previous=AppState.currentState;
  AppState.currentState='background';
  try {
    const handle=createRef<LeaveHandle>(),leave=jest.fn();
    await render(<Harness dirty={false} handle={handle} leave={leave}/>);
    await act(()=>handle.current?.requestLeave(leave));expect(leave).not.toHaveBeenCalled();
    expect(screen.queryByText(leaveCopy.en.title)).toBeNull();
  } finally { AppState.currentState=previous; }
});
it('a captured confirmation from an older warning cannot confirm a later leave intent',async ()=>{
  const handle=createRef<LeaveHandle>(),leave=jest.fn();
  await render(<Harness handle={handle} leave={leave}/>);
  await act(()=>handle.current?.requestLeave(leave));const stale=callback(leaveCopy.en.discard);
  await fireEvent.press(screen.getByRole('button',{name:leaveCopy.en.keep}));
  await act(()=>handle.current?.requestLeave(leave));await act(()=>stale());expect(leave).not.toHaveBeenCalled();
  expect(screen.getByText(leaveCopy.en.title)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button',{name:leaveCopy.en.discard}));expect(leave).toHaveBeenCalledTimes(1);
});
it('a confirmed save retires an open warning without automatically leaving',async ()=>{
  const handle=createRef<LeaveHandle>(),leave=jest.fn();
  const view=await render(<Harness dirty={false} uncertain handle={handle} leave={leave}/>);
  await act(()=>handle.current?.requestLeave(leave));const stale=callback(leaveCopy.en.leave);
  await view.rerender(<Harness dirty={false} handle={handle} leave={leave}/>);
  expect(screen.queryByText(leaveCopy.en.title)).toBeNull();await act(()=>stale());expect(leave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button',{name:'Back'}));expect(leave).toHaveBeenCalledTimes(1);
});
it.each<Language>(['en','sv'])('%s uncertain writes are not called cancelled and only an explicit enabled read checks their result',async language=>{
  const handle=createRef<LeaveHandle>(),leave=jest.fn(),check=jest.fn(),text=leaveCopy[language];
  const view=await render(<Harness language={language} dirty={false} uncertain checkDisabled handle={handle} leave={leave} check={check}/>);
  await act(()=>handle.current?.requestLeave(leave));
  expect(screen.getByText(text.uncertain)).toBeOnTheScreen();expect(screen.queryByText(text.dirty)).toBeNull();
  const blockedCheck=callback(text.check);
  await fireEvent.press(screen.getByRole('button',{name:text.check}));expect(check).not.toHaveBeenCalled();
  await act(()=>blockedCheck());expect(check).not.toHaveBeenCalled();
  await view.rerender(<Harness language={language} dirty={false} uncertain handle={handle} leave={leave} check={check}/>);
  expect(check).not.toHaveBeenCalled();expect(leave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button',{name:text.check}));expect(check).toHaveBeenCalledTimes(1);expect(leave).not.toHaveBeenCalled();
});
it('native modal Back keeps editing; background/unmount erase pending callbacks rather than navigating later',async ()=>{
  let onState:(state:AppStateStatus)=>void=()=>{};
  const remove=jest.fn();
  jest.spyOn(AppState,'addEventListener').mockImplementation((_name,listener)=>{onState=listener;return {remove};});
  const handle=createRef<LeaveHandle>(),leave=jest.fn(),discard=jest.fn();
  const view=await render(<Harness handle={handle} leave={leave} discard={discard}/>);
  await act(()=>handle.current?.requestLeave(leave));
  await act(()=>nativeNode('modal').props.onRequestClose());expect(leave).not.toHaveBeenCalled();
  await act(()=>handle.current?.requestLeave(leave));
  const stale=callback(leaveCopy.en.discard);
  await act(()=>onState('background'));expect(screen.queryByText(leaveCopy.en.title)).toBeNull();
  await act(()=>{onState('active');stale();});expect(leave).not.toHaveBeenCalled();expect(discard).not.toHaveBeenCalled();
  const oldHandle=handle.current!;await view.unmount();await act(()=>{onState('active');oldHandle.requestLeave(leave);});expect(leave).not.toHaveBeenCalled();
  expect(handle.current).toBeNull();expect(remove).toHaveBeenCalledTimes(1);
});
