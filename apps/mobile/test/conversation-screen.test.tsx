import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text, TextInput } from 'react-native';
import { conversationCopy } from '../src/conversation-copy';
import { ConversationScreen, type ConversationState } from '../src/screens/ConversationScreen';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';

const ready: ConversationState = {
  status: 'ready', project: { title: 'A fictional memory', language: 'en' },
  session: { id: '11111111-1111-4111-8111-111111111111', language: 'en' }, resumed: false,
};
function open(state: ConversationState = ready, language: 'en' | 'sv' = 'en') {
  const actions = { onCheck: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  render(<ConversationScreen language={language} state={state} {...actions} />);
  return actions;
}

it.each(['en', 'sv'] as const)('shows verified session details and large navigation controls in %s', language => {
  const text = conversationCopy[language];
  const actions = open({ ...ready, project: { title: 'Ett påhittat minne', language },
    session: { id: '11111111-1111-4111-8111-111111111111', language } }, language);
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText('Ett påhittat minne')).toBeOnTheScreen();
  expect(screen.getByText(text.ready)).toBeOnTheScreen();
  expect(screen.getByText(text.started)).toBeOnTheScreen();
  expect(screen.getByText(`${text.language}: ${language === 'sv' ? text.swedish : text.english}`)).toBeOnTheScreen();
  expect(screen.getByText(text.scope)).toBeOnTheScreen();
  for (const [label, callback] of [[text.back, actions.onBack], [text.signOut, actions.onSignOut]] as const) {
    const button = screen.getByRole('button', { name: label });
    expect(button).toHaveStyle({ minHeight: 56 });
    fireEvent.press(button); expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(screen.UNSAFE_queryByType(TextInput)).toBeNull();
  expect(screen.queryByText(/11111111/)).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('distinguishes a resumed session without inventing previous conversation content', () => {
  open({ ...ready, resumed: true });
  expect(screen.getByText(conversationCopy.en.resumed)).toBeOnTheScreen();
  expect(screen.queryByText(conversationCopy.en.started)).toBeNull();
  expect(screen.queryByText(/you said|Memy said/i)).toBeNull();
  // The feature guidance may mention transcripts; a bare landing screen must
  // still invent no transcript, saved history or assistant reply.
  expect(screen.queryByRole('header', { name: /transcript|saved conversation|simulated reply/i })).toBeNull();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it('hides prior session data while a new request is loading', () => {
  open({ status: 'loading' });
  expect(screen.getByText(conversationCopy.en.loading)).toBeOnTheScreen();
  expect(screen.queryByText('A fictional memory')).toBeNull();
  expect(screen.queryByText(conversationCopy.en.ready)).toBeNull();
  expect(screen.queryByRole('button', { name: conversationCopy.en.check })).toBeNull();
  expect(screen.getByRole('button', { name: conversationCopy.en.back })).toBeOnTheScreen();
});

it.each(Object.keys(conversationCopy.en.errors) as StoryProjectsErrorKind[])('uses translated sanitized %s errors', error => {
  const actions = open({ status: 'error', error }, 'sv'); const text = conversationCopy.sv;
  expect(screen.getByRole('alert')).toHaveTextContent(text.errors[error]);
  expect(screen.queryByText(text.ready)).toBeNull();
  expect(screen.queryByText('A fictional memory')).toBeNull();
  if (['configuration', 'authentication', 'forbidden', 'not-found', 'validation'].includes(error)) {
    expect(screen.queryByRole('button', { name: text.check })).toBeNull();
  }
  else {
    fireEvent.press(screen.getByRole('button', { name: text.check })); expect(actions.onCheck).toHaveBeenCalledTimes(1);
  }
});

it('explains uncertain writes without offering an immediate second start', () => {
  const actions = open({ status: 'error', error: 'timeout', reconcile: true });
  expect(screen.getByText(conversationCopy.en.uncertain)).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: conversationCopy.en.check }));
  expect(actions.onCheck).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: /start a new|new session/i })).toBeNull();
});

it('announces ready and error states without exposing session identifiers', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    const actions = { onCheck: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
    const view = render(<ConversationScreen language="en" state={ready} {...actions} />);
    expect(announce).toHaveBeenCalledWith(conversationCopy.en.ready);
    view.rerender(<ConversationScreen language="en" state={{ status: 'error', error: 'network' }} {...actions} />);
    expect(announce).toHaveBeenCalledWith(conversationCopy.en.errors.network);
  } finally { announce.mockRestore(); }
});

it('keeps text scalable and unclipped without voice or AI controls', () => {
  open();
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
    expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
  expect(screen.queryByRole('button', { name: /record|send|microphone|AI|guest|PDF/i })).toBeNull();
});
