import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StoryDraft } from '../api/story-drafts';
import { useApiBackoff } from '../api/ApiBackoff';
import type { StoryExport } from '../api/story-exports';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { DraftEditingButton } from '../generation/DraftEditorScreen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { exportCopy } from './export-copy';

export interface ExportScreenState {
  phase: 'loading' | 'ready' | 'exporting' | 'downloading' | 'sharing' | 'checking' | 'uncertain' | 'error';
  draft: StoryDraft | null;
  items: StoryExport[];
  hasMore: boolean;
  bounded?: boolean;
  fileReady: boolean;
  prepared?: StoryExport;
  preparedPageCount?: number;
  error?: StoryProjectsErrorKind;
  code?: string;
  notice?: 'prepared' | 'shared' | 'cleanup-failed' | 'source-changed' | 'uncertain';
  selectedExportId?: string;
}
export interface StoryExportsScreenProps {
  language: Language; storyLanguage: Language; title: string; state: ExportScreenState;
  onPrepare: () => void; onShare: () => void; onDownload: (exportId: string) => void;
  onLoadMore: () => void; onRefresh: () => void; onBack: () => void; onSignOut: () => void;
}
/** Presentation only: never loads bytes, writes files or shares automatically. */
export function StoryExportsScreen(props: StoryExportsScreenProps) {
  const key = JSON.stringify([props.state.draft?.draft_id, props.state.draft?.revision]);
  return <StoryExportsView key={key} {...props} />;
}
function StoryExportsView({ language, storyLanguage, title, state, onPrepare, onShare,
  onDownload, onLoadMore, onRefresh, onBack, onSignOut }: StoryExportsScreenProps) {
  const text = exportCopy[language], locale = accessibilityLanguages[language], contentLocale = accessibilityLanguages[storyLanguage];
  const { waiting } = useApiBackoff();
  const [historyOpen, setHistoryOpen] = useState(false), [selected, setSelected] = useState(0);
  const submitted = useRef(false), scroll = useRef<ScrollView>(null);
  const position = useRef({ content: 0, panel: 0, notice: 0 });
  const busy = ['loading', 'exporting', 'downloading', 'sharing', 'checking'].includes(state.phase);
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const visible = state.phase !== 'loading' && !accessFailed;
  const cleanupFailed = state.notice === 'cleanup-failed';
  const canPrepare = !waiting && visible && !!state.draft && state.phase === 'ready' && !state.error && !cleanupFailed;
  const canShare = visible && state.fileReady && !!state.prepared && state.phase === 'ready' && !state.error && !cleanupFailed;
  const index = Math.min(selected, Math.max(0, state.items.length - 1)), item = visible ? state.items[index] : undefined;
  const codeMessage = state.code && Object.hasOwn(text.codes, state.code)
    ? text.codes[state.code as keyof typeof text.codes] : undefined;
  const message = state.error ? codeMessage ?? text.errors[state.error]
    : busy ? text[state.phase as 'loading' | 'exporting' | 'downloading' | 'sharing' | 'checking']
      : state.phase === 'uncertain' ? text.uncertain : state.notice ? text[state.notice]
        : state.fileReady && state.prepared ? text.ready : state.phase === 'error' ? text.errors.unavailable : null;
  useEffect(() => { submitted.current = false; }, [state]);
  useEffect(() => {
    if (!message) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
    if (state.error || state.phase === 'uncertain' || cleanupFailed) {
      scroll.current?.scrollTo({ y: Math.max(0, position.current.content + position.current.panel + position.current.notice - 16), animated: false });
    }
  }, [message, state.error, state.phase, cleanupFailed]);
  const once = (allowed: boolean, action: () => void) => {
    if (!allowed || submitted.current) return;
    submitted.current = true; action();
  };
  const navigate = (next: number) => {
    if (busy) return;
    setSelected(next);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.item + ' ' + (next + 1) + ' ' + text.of + ' ' + state.items.length);
  };
  return <Screen scrollViewRef={scroll} onContentLayout={event => { position.current.content = event.nativeEvent.layout.y; }}>
    <MemyBrand />
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.title}</Text>
    {!accessFailed && <Text accessibilityRole="header" accessibilityLanguage={contentLocale} allowFontScaling selectable style={styles.storyTitle}>{title}</Text>}
    <View style={styles.panel} accessibilityState={{ busy }} onLayout={event => { position.current.panel = event.nativeEvent.layout.y; }}>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.verification}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.disclosure}</Text>
      {message && <Text accessibilityRole={state.error || state.phase === 'error' || state.phase === 'uncertain' || cleanupFailed ? 'alert' : undefined}
        accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.notice}
        onLayout={event => { position.current.notice = event.nativeEvent.layout.y; }}>{message}</Text>}
      {state.phase === 'uncertain' && state.error && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.uncertain}</Text>}
      {visible && state.draft && <View style={styles.card}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.current}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.generation}: {state.draft.version}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.revision}: {state.draft.revision}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.language}: {storyLanguage === 'sv' ? text.swedish : text.english}</Text>
        <DraftEditingButton language={language} label={text.prepare} primary={!canShare} disabled={!canPrepare}
          onPress={() => once(canPrepare, onPrepare)} />
      </View>}
      {visible && state.fileReady && state.prepared && !cleanupFailed && <View style={styles.card}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.readyTitle}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.preparedTitle}</Text>
        <Text accessibilityLanguage={accessibilityLanguages[state.prepared.language]} allowFontScaling selectable style={styles.body}>{state.prepared.title}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.generation}: {state.prepared.draft_version}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.revision}: {state.prepared.draft_revision}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.pages}: {state.preparedPageCount ?? state.prepared.page_count}</Text>
        <DraftEditingButton language={language} label={text.share} primary disabled={!canShare} onPress={() => once(canShare, onShare)} />
      </View>}
      {visible && <>
        <DraftEditingButton language={language} label={historyOpen ? text.hideHistory : text.history} expanded={historyOpen}
          disabled={busy} onPress={() => setHistoryOpen(open => !open)} />
        {historyOpen && <View style={styles.panel}>
          <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.historyTitle}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.historyHelp}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.loadedOnly}</Text>
          {state.bounded && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.bounded}</Text>}
          {!item ? <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.noHistory}</Text> : <View style={styles.card}>
            <Text accessibilityRole="header" accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.label}>
              {text.item} {index + 1} {text.of} {state.items.length}
            </Text>
            <Text accessibilityLanguage={accessibilityLanguages[item.language]} allowFontScaling selectable style={styles.body}>{item.title}</Text>
            <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.generation}: {item.draft_version}</Text>
            <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.revision}: {item.draft_revision}</Text>
            <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.pages}: {item.page_count}</Text>
            <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.savedAt}: {new Date(item.created_at).toLocaleString(locale)}</Text>
            <DraftEditingButton language={language} label={text.open}
              disabled={waiting || state.phase !== 'ready' || !!state.error || cleanupFailed || state.notice === 'uncertain'}
              onPress={() => once(!waiting && state.phase === 'ready' && !state.error && !cleanupFailed && state.notice !== 'uncertain', () => onDownload(item.export_id))} />
            <DraftEditingButton language={language} label={text.previous} disabled={busy || index === 0} onPress={() => navigate(index - 1)} />
            <DraftEditingButton language={language} label={text.next} disabled={busy || index + 1 >= state.items.length} onPress={() => navigate(index + 1)} />
          </View>}
          {state.hasMore && !state.bounded && <DraftEditingButton language={language} label={text.loadMore}
            disabled={waiting || busy || !!state.error || cleanupFailed || state.phase === 'uncertain' || state.notice === 'uncertain'} onPress={() => once(!waiting && !busy && !state.error && !cleanupFailed && state.phase !== 'uncertain' && state.notice !== 'uncertain', onLoadMore)} />}
        </View>}
      </>}
      <DraftEditingButton language={language} label={text.refresh} primary={state.phase === 'uncertain' || (state.phase === 'error' && !accessFailed)}
        disabled={waiting || busy || accessFailed || cleanupFailed} onPress={() => once(!waiting && !busy && !accessFailed && !cleanupFailed, onRefresh)} />
      <DraftEditingButton language={language} label={text.back} onPress={onBack} />
      <DraftEditingButton language={language} label={text.signOut} onPress={onSignOut} />
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  panel: { width: '100%', gap: 24 }, card: { width: '100%', gap: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, textAlign: 'center', flexShrink: 1 },
  label: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
