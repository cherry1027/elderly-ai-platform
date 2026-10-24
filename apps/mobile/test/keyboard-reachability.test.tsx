import { getComponent } from './component-probe';
import { nativeNodes, nativeNode, nativeRef, contentLayout } from './native-tree';
import { createRef, type ReactElement, type ComponentRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { Screen } from '../src/components/Screen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { RegistrationScreen } from '../src/screens/RegistrationScreen';
import { CreateStoryScreen } from '../src/screens/CreateStoryScreen';
import { EditStoryScreen } from '../src/screens/EditStoryScreen';
import { MemoryReviewScreen, type MemoryReviewState } from '../src/memories/MemoryReviewScreen';
import { authCopy } from '../src/auth-copy';
import { registrationCopy } from '../src/registration-copy';
import { createStoryCopy } from '../src/create-story-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { memoryReviewCopy } from '../src/memories/memory-review-copy';
import { SIMULATED_TRANSCRIPT_NOTICE } from '../src/api/audio-transcripts';
import type { StoryProject } from '../src/api/story-projects';
import type { Language } from '../src/i18n';

jest.mock('../src/components/Screen', () => {
  const actual = jest.requireActual<typeof import('../src/components/Screen')>('../src/components/Screen');
  const { observeComponent } = jest.requireActual<typeof import('./component-probe')>('./component-probe');
  return { ...actual, Screen: observeComponent(actual.Screen) };
});

const project: StoryProject = { id:'40000000-0000-4000-8000-000000000001', title:'A fictional story', description:null,
  language:'en',status:'draft',created_at:'2026-10-24T08:00:00Z',updated_at:'2026-10-24T08:00:00Z' };
const sourceId='20000000-0000-4000-8000-000000000001',sessionId='10000000-0000-4000-8000-000000000001';
const review: MemoryReviewState = {phase:'ready',complete:true,clarifications:[],sources:[{id:sourceId,session_id:sessionId,
  sequence:1,role:'user',language:'en',text:SIMULATED_TRANSCRIPT_NOTICE+'I moved in 1974.',created_at:project.created_at}],
memories:[{id:'30000000-0000-4000-8000-000000000001',project_id:project.id,session_id:sessionId,source_message_id:sourceId,
  fact_type:'event',value:'1974',evidence:'I moved in 1974.',year:1974,slot:'move',uncertain:false,status:'pending',
  corrected_value:null,version:1,created_at:project.created_at,updated_at:project.updated_at}]};
const noop=()=>{};
function cases(language:Language,write:jest.Mock):{name:string;element:ReactElement;input:string;value:string;prepare?:()=>Promise<void>}[]{
 return [
  {name:'Login',element:<LoginScreen language={language} busy={false} error={null} onBack={noop} onSignIn={write}/>,input:authCopy[language].password,value:'synthetic-only-password'},
  {name:'Registration',element:<RegistrationScreen language={language} enabled={false} onSubmit={write} onBack={noop} onLogin={noop}/>,input:registrationCopy[language].confirmation,value:'synthetic-only-confirmation'},
  {name:'Create Story',element:<CreateStoryScreen language={language} state={{status:'idle'}} serviceAvailable={false} onSubmit={write} onBack={noop} onSignOut={noop}/>,input:createStoryCopy[language].titleLabel,value:'My fictional summer'},
  {name:'Edit Story',element:<EditStoryScreen language={language} project={project} state={{status:'idle'}} onSubmit={write} onBack={noop} onSignOut={noop}/>,input:storyDetailsCopy[language].titleLabel,value:'A revised fictional title'},
  {name:'Memory correction',element:<MemoryReviewScreen language={language} title={project.title} state={review} onSave={write} onRefresh={noop} onBack={noop} onSignOut={noop}/>,input:memoryReviewCopy[language].correctionLabel,value:'1975',
   prepare:async ()=>await fireEvent.press(screen.getByRole('radio',{name:memoryReviewCopy[language].correct}))},
 ];
}
afterEach(async ()=>{await cleanup();jest.restoreAllMocks();expect(globalThis.fetch).not.toHaveBeenCalled();});

it.each((['en','sv'] as const).flatMap(language=>cases(language,jest.fn(async()=>{})).map(item=>({language,name:item.name}))))('$language $name uses native keyboard insets, retains values on Done and never submits implicitly',async ({language,name})=>{
 jest.replaceProperty(Platform,'OS','ios');
 const dismiss=jest.spyOn(Keyboard,'dismiss');
  const write=jest.fn(async()=>{}),active=cases(language,write).find(next=>next.name===name)!;
  await render(active.element); await active.prepare?.();
  const scroll=nativeNode('scroll');
  expect(nativeNodes('scroll')).toHaveLength(1);
  expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  expect(scroll.props.keyboardDismissMode).toBe('interactive');
  expect(getComponent(KeyboardAvoidingView).props.enabled).toBe(false);
  expect(scroll.props.scrollEnabled).not.toBe(false);
  await fireEvent.changeText(screen.getByLabelText(active.input),active.value);
  await fireEvent(screen.getByLabelText(active.input),'submitEditing');
  expect(dismiss).toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  expect(screen.getByLabelText(active.input).props.value).toBe(active.value);
  expect(screen.getByLabelText(active.input).props.allowFontScaling).toBe(true);
  if(name==='Create Story')expect(screen.getByRole('radio',{name:createStoryCopy[language].swedish})).toBeOnTheScreen();
  if(name==='Registration')expect(screen.getByRole('button',{name:registrationCopy[language].checkDetails})).toBeOnTheScreen();
  if(name==='Edit Story')expect(screen.getByRole('button',{name:storyDetailsCopy[language].save})).toBeOnTheScreen();
});

it('reveals the focused native target when the keyboard is already open and after its real show event, with no timer/height guess',async ()=>{
 jest.spyOn(Keyboard,'isVisible').mockReturnValue(true);
 const listeners:{listener:()=>void;remove:jest.Mock}[]=[];
 jest.spyOn(Keyboard,'addListener').mockImplementation((_name,listener)=>{
  const record={listener:listener as ()=>void,remove:jest.fn()};listeners.push(record);
  return {remove:record.remove} as unknown as ReturnType<typeof Keyboard.addListener>;
 });
 const ref=createRef<ComponentRef<typeof ScrollView>>(),reveal=jest.fn();
 const view=await render(<Screen keyboardAware scrollViewRef={ref}><TextInput accessibilityLabel="Fictional input"/></Screen>);
 jest.spyOn(nativeRef(ref), 'scrollResponderScrollNativeHandleToKeyboard').mockImplementation(reveal);
 const scroll=nativeNode('scroll');
 await act(()=>scroll.props.onFocus({nativeEvent:{target:37}}));
 expect(reveal).toHaveBeenLastCalledWith(37,16,true);
 await act(()=>listeners.forEach(item=>item.listener()));expect(reveal).toHaveBeenCalledTimes(2);
 await act(()=>scroll.props.onBlur());await act(()=>listeners.forEach(item=>item.listener()));expect(reveal).toHaveBeenCalledTimes(2);
 await act(()=>scroll.props.onFocus({nativeEvent:{target:52}}));expect(reveal).toHaveBeenLastCalledWith(52,16,true);
 await view.unmount();const before=reveal.mock.calls.length;
 await act(()=>listeners.forEach(item=>item.listener()));expect(reveal).toHaveBeenCalledTimes(before);
 listeners.forEach(item=>expect(item.remove).toHaveBeenCalledTimes(1));
});

it('uses Android height avoidance without enabling iOS native insets and leaves ordinary B1 screens unchanged',async ()=>{
 jest.replaceProperty(Platform,'OS','android');
 await render(cases('en',jest.fn(async()=>{}))[1].element);
 expect(getComponent(KeyboardAvoidingView).props.enabled).toBe(true);
 expect(getComponent(KeyboardAvoidingView).props.behavior).toBe('height');
 expect(nativeNode('scroll').props.automaticallyAdjustKeyboardInsets).toBe(false);
 expect(nativeNode('scroll').props.keyboardDismissMode).toBe('on-drag');
});

it('leaves ordinary B1 screens without form keyboard behavior',async ()=>{
 await render(<Screen><View/></Screen>);
 const scroll=nativeNode('scroll');
 expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(false);expect(scroll.props.keyboardDismissMode).toBeUndefined();
});

it.each<Language>(['en','sv'])('%s account errors do not override focused-field scrolling while the keyboard is visible',async language=>{
 jest.spyOn(Keyboard,'isVisible').mockReturnValue(true);
 const scrollTo=jest.fn(),reveal=jest.fn();
 await render(<LoginScreen language={language} busy={false} error="network" onBack={noop} onSignIn={jest.fn(async()=>{})}/>);
 const container=getComponent(Screen);
 jest.spyOn(nativeRef(container.props.scrollViewRef), 'scrollTo').mockImplementation(scrollTo); jest.spyOn(nativeRef(container.props.scrollViewRef), 'scrollResponderScrollNativeHandleToKeyboard').mockImplementation(reveal);
 const scroll=nativeNode('scroll');
 await contentLayout(getComponent(Screen).props.onContentLayout);
 await act(()=>scroll.props.onFocus({nativeEvent:{target:13}}));
 expect(scrollTo).not.toHaveBeenCalled();expect(reveal).toHaveBeenCalledWith(13,16,true);
 expect(screen.getByRole('alert')).toHaveTextContent(authCopy[language].errors.network);
});
