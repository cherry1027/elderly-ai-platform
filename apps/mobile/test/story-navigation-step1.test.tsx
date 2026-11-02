import { nativeNodes } from './native-tree';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import type { Language } from '../src/i18n';
import { Screen } from '../src/components/Screen';
import { StoryDetailsScreen } from '../src/screens/StoryDetailsScreen';
import { CreateStoryScreen } from '../src/screens/CreateStoryScreen';
import { EditStoryScreen } from '../src/screens/EditStoryScreen';
import { ConversationScreen } from '../src/screens/ConversationScreen';
import { MemoryReviewScreen } from '../src/memories/MemoryReviewScreen';
import { StoryDraftScreen } from '../src/generation/StoryDraftScreen';
import { DraftEditorScreen } from '../src/generation/DraftEditorScreen';
import { DraftHistoryScreen } from '../src/generation/DraftHistoryScreen';
import { GenerationBrowserScreen } from '../src/generation/GenerationBrowserScreen';
import { StoryExportsScreen } from '../src/exports/StoryExportsScreen';
import { createStoryCopy } from '../src/create-story-copy';
import { storyDetailsCopy } from '../src/story-details-copy';
import { leaveCopy } from '../src/navigation/useGuardedLeave';
import { colors } from '../src/theme';

const noop = () => {};
const project = { id: '11111111-1111-4111-8111-111111111111', title: 'A saved story', description: null,
  language: 'en' as const, status: 'draft', created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z' };
function workflows(language: Language, onBack: () => void) {
  const common = { language, storyLanguage: language, title: project.title, onBack, onSignOut: noop,
    onRefresh: noop, onLoadMore: noop };
  return {
    details: <StoryDetailsScreen {...common} state={{ status: 'ready', project }} onEdit={noop} />,
    create: <CreateStoryScreen {...common} state={{ status: 'idle' }} serviceAvailable={false} onSubmit={noop} />,
    metadata: <EditStoryScreen {...common} project={project} state={{ status: 'idle' }} onSubmit={noop} />,
    conversation: <ConversationScreen {...common} state={{ status: 'loading' }} onCheck={noop} />,
    liveConversation: <ConversationScreen {...common} state={{ status: 'ready', project,
      session: { id: 'synthetic-session', language }, resumed: true }} onCheck={noop} recordingPanel={<Text>Recording panel</Text>} />,
    memories: <MemoryReviewScreen {...common} state={{ phase: 'ready', memories: [], clarifications: [], sources: [], complete: true }} onSave={noop} />,
    autobiography: <StoryDraftScreen {...common} state={{ phase: 'ready', draft: null, verification: null, canRetry: false }}
      onGenerate={noop} onRetry={noop} onReviewMemories={noop} />,
    editor: <DraftEditorScreen {...common} state={{ phase: 'loading', draft: null, text: '', canRetry: false, dirty: false }}
      onChangeText={noop} onSave={noop} onCheck={noop} onRetry={noop} onUseLatest={noop} onKeepMine={noop} />,
    history: <DraftHistoryScreen {...common} state={{ phase: 'ready', draft: null, items: [], hasMore: false }} />,
    generations: <GenerationBrowserScreen {...common} selectedDraftId={null}
      state={{ phase: 'ready', items: [], hasMore: false }} onOpen={noop} />,
    exports: <StoryExportsScreen {...common} state={{ phase: 'ready', draft: null, items: [], hasMore: false, fileReady: false }}
      onPrepare={noop} onShare={noop} onDownload={noop} />,
  };
}

afterEach(() => { jest.restoreAllMocks(); expect(globalThis.fetch).not.toHaveBeenCalled(); });

it.each((['en', 'sv'] as const).flatMap(language => Object.keys(workflows(language, noop)).map(name => ({ language, name }))))(
  '$language $name has a fixed top Back wired to its existing callback', async ({ language, name }) => {
    const onBack = jest.fn(), views = workflows(language, onBack);
    await render(views[name as keyof typeof views]);
    const back = screen.getByTestId('story-top-back');
    expect(back).toHaveStyle({ minHeight: 56, minWidth: 56, alignSelf: 'flex-start', maxWidth: '100%' });
    expect(back.props.accessibilityLanguage).toBe(language === 'en' ? 'en-GB' : 'sv-SE');
    expect(back.props.accessibilityLabel).toMatch(language === 'en' ? /^Go back: / : /^Gå tillbaka: /);
    expect(within(back).getByText(language === 'en' ? 'Back' : 'Tillbaka')).toBeOnTheScreen();
    for (const scroll of nativeNodes('scroll')) expect(within(scroll).queryByTestId('story-top-back')).toBeNull();
    await fireEvent.press(back); expect(onBack).toHaveBeenCalledTimes(1);
  },
);

it.each(['en', 'sv'] as const)('top Back reuses the form guard and retains unsaved metadata in %s', async language => {
  const onBack = jest.fn(), warning = leaveCopy[language], text = storyDetailsCopy[language];
  await render(<EditStoryScreen language={language} project={project} state={{ status: 'idle' }}
    onSubmit={noop} onBack={onBack} onSignOut={noop} />);
  await fireEvent.changeText(screen.getByLabelText(text.titleLabel), 'Unsaved title');
  await fireEvent.press(screen.getByTestId('story-top-back'));
  expect(screen.getByText(warning.dirty)).toBeOnTheScreen(); expect(onBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: warning.keep }));
  expect(screen.getByLabelText(text.titleLabel).props.value).toBe('Unsaved title');
  await fireEvent.press(screen.getByTestId('story-top-back'));
  await fireEvent.press(screen.getByRole('button', { name: warning.discard })); expect(onBack).toHaveBeenCalledTimes(1);
});

it('top Back reuses the uncertain create warning without submitting again', async () => {
  const onBack = jest.fn(), onSubmit = jest.fn();
  await render(<CreateStoryScreen language="en" state={{ status: 'error', error: 'network', uncertain: true }}
    serviceAvailable onSubmit={onSubmit} onBack={onBack} onSignOut={noop} />);
  await fireEvent.changeText(screen.getByLabelText(createStoryCopy.en.titleLabel), 'A draft');
  await fireEvent.press(screen.getByTestId('story-top-back'));
  expect(screen.getByText(leaveCopy.en.uncertain)).toBeOnTheScreen();
  expect(onBack).not.toHaveBeenCalled(); expect(onSubmit).not.toHaveBeenCalled();
});

// Structural layout checks: native line wrapping and physical VoiceOver are
// verified separately on the iPhone. No fixed text height, truncation or overlay.
it.each(['en', 'sv'] as const)('keeps Back and separate controls scalable at a narrow width in %s', async language => {
  const dimensions = { width: 320, height: 568, scale: 2, fontScale: 3.2 };
  jest.spyOn(Dimensions, 'get').mockReturnValue(dimensions);
  const onPress = jest.fn();
  await render(<Screen keyboardAware back={{ language, label: 'A saved story', onPress }} bottomControls={<Text allowFontScaling>Consent and recording controls</Text>}>
    <Text allowFontScaling>{'A long saved conversation. '.repeat(100)}</Text>
  </Screen>);
  const navigation = screen.getByTestId('story-top-navigation');
  expect(navigation).toHaveStyle({ flexShrink: 0 });
  expect(StyleSheet.flatten(navigation.props.style).height).toBeUndefined();
  const back = screen.getByTestId('story-top-back');
  expect(back).toHaveStyle({ maxWidth: '100%', minHeight: 56 });
  const label = within(back).getByText(language === 'sv' ? 'Tillbaka' : 'Back');
  expect(label).toHaveStyle({ flexShrink: 1 });
  for (const node of nativeNodes('text')) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined();
  }
  const history = screen.getByTestId('story-content-scroll'), controls = screen.getByTestId('story-bottom-controls');
  expect(history).toHaveStyle({ flex: 1, minHeight: 0 });
  expect(history.props.automaticallyAdjustKeyboardInsets).toBe(true);
  expect(controls).toHaveStyle({ maxHeight: '50%', flexShrink: 1, flexGrow: 0 });
  expect(controls.props.scrollEnabled).not.toBe(false); expect(controls.props.keyboardShouldPersistTaps).toBe('handled');
  expect(StyleSheet.flatten(controls.props.style).position).not.toBe('absolute');
  expect(within(history).queryByText('Consent and recording controls')).toBeNull();
  expect(within(controls).getByText('Consent and recording controls')).toBeOnTheScreen();
  await fireEvent(back, 'focus'); expect(back).toHaveStyle({ borderColor: colors.ink });
  await fireEvent.press(back); expect(onPress).toHaveBeenCalledTimes(1);
});

it('leaves ordinary root Screen composition unchanged unless the story opts in', async () => {
  await render(<Screen><Text>Root content</Text></Screen>);
  expect(screen.queryByTestId('story-top-back')).toBeNull(); expect(screen.queryByTestId('story-bottom-controls')).toBeNull();
  expect(nativeNodes('scroll')).toHaveLength(1);
});
