import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text, TextInput } from 'react-native';
import type { StoryDraft } from '../src/api/story-drafts';
import type { StoryExport } from '../src/api/story-exports';
import type { StoryProjectsErrorKind } from '../src/api/story-projects';
import { StoryExportsScreen, type ExportScreenState } from '../src/exports/StoryExportsScreen';
import { exportCopy } from '../src/exports/export-copy';
import type { Language } from '../src/i18n';

const draft: StoryDraft = { draft_id: '95000000-0000-4000-8000-000000000001', project_id: '95200000-0000-4000-8000-000000000001',
  status: 'edited', language: 'en', style: 'warm', version: 2, revision: 3, content: 'Private fictional edited wording.',
  original_content: 'Original fictional wording.', mode: 'mock', source_memories: [],
  verification: { status: 'needs_review', unsupported_claims: [], method: 'manual_unverified', checked_revision: 3,
    checked_at: '2026-10-23T10:00:00Z', sources_current: true, reason: null },
  created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:10:00Z' };
const first: StoryExport = { export_id: '95600000-0000-4000-8000-000000000002', draft_id: draft.draft_id, project_id: draft.project_id,
  draft_version: 2, draft_revision: 3, language: 'en', title: 'Fictional English memories', format: 'pdf', include_title_page: true,
  include_page_numbers: true, renderer_version: 'memy_pdf_v1', filename: 'memy-fictional-english-memories-v2-r3.pdf',
  content_sha256: 'a'.repeat(64), byte_size: 47000, page_count: 3, created_at: '2026-10-23T10:10:00Z' };
const earlier: StoryExport = { ...first, export_id: '95600000-0000-4000-8000-000000000001', draft_version: 1, draft_revision: 2,
  title: 'Fiktiva minnen från Malmö', language: 'sv', filename: 'memy-fiktiva-minnen-fran-malmo-v1-r2.pdf',
  created_at: '2026-10-23T10:05:00Z', page_count: 2 };
const initial: ExportScreenState = { phase: 'ready', draft, items: [first, earlier], hasMore: false, fileReady: false };
function open(state: ExportScreenState = initial, language: Language = 'en', storyLanguage: Language = 'en') {
  const actions = { onPrepare: jest.fn(), onShare: jest.fn(), onDownload: jest.fn(), onLoadMore: jest.fn(),
    onRefresh: jest.fn(), onBack: jest.fn(), onSignOut: jest.fn() };
  return { ...render(<StoryExportsScreen language={language} storyLanguage={storyLanguage} title="Fictional story"
    state={state} {...actions} />), ...actions };
}
function tap(label: string) { fireEvent.press(screen.getByRole('button', { name: label })); }

it.each(['en', 'sv'] as const)('has explicit preparation, simulation, manual-verification and disclosure text in %s', language => {
  const actions = open(initial, language), text = exportCopy[language];
  expect(screen.getByRole('header', { name: text.title })).toBeOnTheScreen();
  expect(screen.getByText(text.simulation)).toBeOnTheScreen(); expect(screen.getByText(text.verification)).toBeOnTheScreen();
  expect(screen.getByText(text.disclosure)).toBeOnTheScreen(); expect(screen.getByText(text.generation + ': 2')).toBeOnTheScreen();
  expect(screen.getByText(text.revision + ': 3')).toBeOnTheScreen(); expect(screen.queryByText(draft.content)).toBeNull();
  expect(screen.queryByText(draft.original_content)).toBeNull(); expect(screen.queryByRole('button', { name: text.share })).toBeNull();
  expect(actions.onPrepare).not.toHaveBeenCalled(); expect(actions.onShare).not.toHaveBeenCalled();
  expect(actions.onDownload).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  tap(text.prepare); tap(text.prepare); expect(actions.onPrepare).toHaveBeenCalledTimes(1); expect(actions.onShare).not.toHaveBeenCalled();
});

it.each(['en', 'sv'] as const)('shares only a prepared, identified file after a separate explicit action in %s', language => {
  const actions = open({ ...initial, fileReady: true, prepared: earlier, notice: 'prepared' }, language), text = exportCopy[language];
  expect(screen.getByRole('header', { name: text.readyTitle })).toBeOnTheScreen();
  expect(screen.getByText(earlier.title).props.accessibilityLanguage).toBe('sv-SE');
  expect(screen.getByText(text.generation + ': 1')).toBeOnTheScreen(); expect(screen.getByText(text.revision + ': 2')).toBeOnTheScreen();
  expect(screen.getByText(text.generation + ': 2')).toBeOnTheScreen(); expect(screen.getByText(text.revision + ': 3')).toBeOnTheScreen();
  expect(actions.onShare).not.toHaveBeenCalled(); tap(text.share); tap(text.share); expect(actions.onShare).toHaveBeenCalledTimes(1);
  expect(actions.onPrepare).not.toHaveBeenCalled(); expect(actions.onDownload).not.toHaveBeenCalled();
});

it('does not offer sharing merely because an unidentified file is reported ready', () => {
  open({ ...initial, fileReady: true }); expect(screen.queryByRole('button', { name: exportCopy.en.share })).toBeNull();
});

it.each(['loading', 'exporting', 'downloading', 'sharing', 'checking'] as const)('blocks duplicate operations while %s and provides accessible progress', phase => {
  const actions = open({ ...initial, phase, fileReady: true, prepared: first }), text = exportCopy.en;
  expect(screen.getByText(text[phase])).toBeOnTheScreen();
  const prepare = screen.queryByRole('button', { name: text.prepare }); if (prepare) expect(prepare).toBeDisabled();
  const share = screen.queryByRole('button', { name: text.share }); if (share) expect(share).toBeDisabled();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  expect(actions.onPrepare).not.toHaveBeenCalled(); expect(actions.onShare).not.toHaveBeenCalled();
});

it('places actual history behind a secondary disclosure and opens only the selected persisted export', () => {
  const actions = open(), text = exportCopy.en; expect(screen.queryByText(first.title)).toBeNull();
  expect(screen.getByRole('button', { name: text.history }).props.accessibilityState).toMatchObject({ expanded: false });
  tap(text.history); expect(screen.getByRole('button', { name: text.hideHistory }).props.accessibilityState).toMatchObject({ expanded: true });
  expect(screen.getByText(first.title)).toBeOnTheScreen(); expect(screen.queryByText(earlier.title)).toBeNull();
  expect(screen.getByRole('button', { name: text.previous })).toBeDisabled(); tap(text.next);
  expect(screen.getByText(earlier.title)).toBeOnTheScreen(); expect(screen.queryByText(first.title)).toBeNull();
  expect(screen.getByRole('button', { name: text.next })).toBeDisabled(); tap(text.open); tap(text.open);
  expect(actions.onDownload).toHaveBeenCalledTimes(1); expect(actions.onDownload).toHaveBeenCalledWith(earlier.export_id);
  expect(actions.onShare).not.toHaveBeenCalled(); expect(actions.onPrepare).not.toHaveBeenCalled();
  expect(screen.queryByText(first.filename)).toBeNull(); expect(screen.queryByText(earlier.export_id)).toBeNull();
  expect(screen.UNSAFE_queryByType(TextInput)).toBeNull(); expect(screen.queryByRole('button', { name: /restore|regenerate/i })).toBeNull();
});

it('has honest empty, partial and bounded history states without invented PDF rows', () => {
  const actions = open({ ...initial, items: [], hasMore: true }), text = exportCopy.en;
  tap(text.history); expect(screen.getByText(text.noHistory)).toBeOnTheScreen(); expect(screen.getByText(text.loadedOnly)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: text.open })).toBeNull(); tap(text.loadMore); expect(actions.onLoadMore).toHaveBeenCalledTimes(1);
  actions.rerender(<StoryExportsScreen language="en" storyLanguage="en" title="Fictional story"
    state={{ ...initial, bounded: true, hasMore: true }} {...actions} />);
  expect(screen.getByText(text.bounded)).toBeOnTheScreen(); expect(screen.queryByRole('button', { name: text.loadMore })).toBeNull();
});

it('reconciles an uncertain result only through an explicit read check', () => {
  const actions = open({ ...initial, phase: 'uncertain', fileReady: true, prepared: first }), text = exportCopy.en;
  expect(screen.getByRole('alert')).toHaveTextContent(text.uncertain); expect(screen.getByRole('button', { name: text.prepare })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.share })).toBeDisabled(); tap(text.history);
  expect(screen.getByRole('button', { name: text.open })).toBeDisabled(); tap(text.refresh);
  expect(actions.onRefresh).toHaveBeenCalledTimes(1); expect(actions.onPrepare).not.toHaveBeenCalled(); expect(actions.onDownload).not.toHaveBeenCalled();
});

it.each(Object.keys(exportCopy.en.errors) as StoryProjectsErrorKind[])('displays sanitized translated %s failure', error => {
  open({ ...initial, phase: 'error', error }, 'sv'); expect(screen.getByRole('alert')).toHaveTextContent(exportCopy.sv.errors[error]);
  expect(screen.queryByText(/Bearer|access_token|refresh_token|PRIVATE_SERVER_REASON/)).toBeNull();
});

it.each(Object.keys(exportCopy.en.codes) as (keyof typeof exportCopy.en.codes)[])('shows friendly %s guidance instead of raw backend data', code => {
  open({ ...initial, phase: 'error', error: 'unavailable', code }, 'sv');
  expect(screen.getByRole('alert')).toHaveTextContent(exportCopy.sv.codes[code]); expect(screen.queryByText(code)).toBeNull();
});

it('falls back to a safe error for an unrecognized backend code', () => {
  open({ ...initial, phase: 'error', error: 'unavailable', code: 'PRIVATE_SERVER_REASON' });
  expect(screen.getByRole('alert')).toHaveTextContent(exportCopy.en.errors.unavailable); expect(screen.queryByText('PRIVATE_SERVER_REASON')).toBeNull();
});

it.each(['authentication', 'forbidden', 'not-found'] as const)('hides private title, revision, history and file after %s failure', error => {
  const actions = open({ ...initial, phase: 'error', error, fileReady: true, prepared: first, hasMore: true }), text = exportCopy.en;
  expect(screen.queryByText('Fictional story')).toBeNull(); expect(screen.queryByText(first.title)).toBeNull();
  expect(screen.queryByText(text.generation + ': 2')).toBeNull(); expect(screen.queryByRole('button', { name: text.share })).toBeNull();
  expect(screen.queryByRole('button', { name: text.prepare })).toBeNull(); expect(screen.queryByRole('button', { name: text.history })).toBeNull();
  expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled(); tap(text.back); tap(text.signOut);
  expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
});

it('fails closed after cleanup failure without offering another share or download', () => {
  const actions = open({ ...initial, fileReady: true, prepared: first, notice: 'cleanup-failed' }), text = exportCopy.en;
  expect(screen.getByRole('alert')).toHaveTextContent(text['cleanup-failed']); expect(screen.queryByRole('button', { name: text.share })).toBeNull();
  expect(screen.getByRole('button', { name: text.prepare })).toBeDisabled(); expect(screen.getByRole('button', { name: text.refresh })).toBeDisabled();
  tap(text.history); expect(screen.getByRole('button', { name: text.open })).toBeDisabled(); expect(actions.onShare).not.toHaveBeenCalled();
});

it('does not claim that closing the native share sheet proved successful delivery', () => {
  open({ ...initial, notice: 'shared' }); expect(screen.getByText(exportCopy.en.shared)).toBeOnTheScreen();
  expect(screen.queryByText(/successfully sent|delivery confirmed/i)).toBeNull();
});

it('announces generic progress and counts without automatically reading private story text or titles', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  try {
    open(); tap(exportCopy.en.history); announce.mockClear(); tap(exportCopy.en.next);
    expect(announce).toHaveBeenCalledWith('Saved PDF 2 of 2'); expect(announce).not.toHaveBeenCalledWith(earlier.title);
    expect(announce).not.toHaveBeenCalledWith(draft.content);
  } finally { announce.mockRestore(); }
});

it.each(['en', 'sv'] as const)('provides independent Back, Sign Out and Check actions in %s', language => {
  const actions = open(initial, language), text = exportCopy[language]; tap(text.refresh); tap(text.back); tap(text.signOut);
  expect(actions.onRefresh).toHaveBeenCalledTimes(1); expect(actions.onBack).toHaveBeenCalledTimes(1); expect(actions.onSignOut).toHaveBeenCalledTimes(1);
});

it('supports large controls, scalable untruncated text and correct content languages', () => {
  open({ ...initial, fileReady: true, prepared: earlier }, 'sv', 'en'); tap(exportCopy.sv.history);
  expect(screen.getByText('Fictional story').props.accessibilityLanguage).toBe('en-GB');
  expect(screen.getByText(first.title).props.accessibilityLanguage).toBe('en-GB');
  for (const button of screen.getAllByRole('button')) expect(button).toHaveStyle({ minHeight: 56 });
  for (const node of screen.UNSAFE_getAllByType(Text)) {
    expect(node.props.allowFontScaling).toBe(true); expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.maxFontSizeMultiplier).toBeUndefined(); expect(StyleSheet.flatten(node.props.style)?.maxHeight).toBeUndefined();
  }
});

it('resets history position when the selected saved revision changes', () => {
  const actions = open(), text = exportCopy.en; tap(text.history); tap(text.next);
  actions.rerender(<StoryExportsScreen language="en" storyLanguage="en" title="Fictional story"
    state={{ ...initial, draft: { ...draft, revision: 4 } }} {...actions} />);
  expect(screen.queryByText(text.historyTitle)).toBeNull(); tap(text.history); expect(screen.getByText(first.title)).toBeOnTheScreen();
});

it('reports the actual validated download page count instead of the historical first-render measurement', () => {
  open({ ...initial, fileReady: true, prepared: first, preparedPageCount: 4 });
  expect(screen.getByText(exportCopy.en.pages + ': 4')).toBeOnTheScreen();
  expect(screen.queryByText(exportCopy.en.pages + ': 3')).toBeNull();
});

it('keeps history downloads and paging disabled while an unresolved action awaits deliberate retry', () => {
  const actions = open({ ...initial, notice: 'uncertain', hasMore: true }), text = exportCopy.en;
  expect(screen.getByRole('button', { name: text.prepare })).toBeEnabled(); tap(text.history);
  expect(screen.getByRole('button', { name: text.open })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.loadMore })).toBeDisabled();
  expect(screen.getByRole('button', { name: text.refresh })).toBeEnabled();
  expect(actions.onDownload).not.toHaveBeenCalled(); expect(actions.onLoadMore).not.toHaveBeenCalled();
});

it.each(['network', 'timeout', 'invalid-response', 'conflict', 'unavailable'] as const)('blocks historical Open after %s failure until a successful fresh check', error => {
  const actions = open({ ...initial, phase: 'error', error }), text = exportCopy.en;
  tap(text.history); const button = screen.getByRole('button', { name: text.open });
  expect(button).toBeDisabled(); fireEvent.press(button); expect(actions.onDownload).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: text.refresh })).toBeEnabled();
});

it('fails closed if a ready phase still carries an unresolved error', () => {
  const actions = open({ ...initial, error: 'network' }), text = exportCopy.en;
  tap(text.history); expect(screen.getByRole('button', { name: text.open })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: text.open })); expect(actions.onDownload).not.toHaveBeenCalled();
});
