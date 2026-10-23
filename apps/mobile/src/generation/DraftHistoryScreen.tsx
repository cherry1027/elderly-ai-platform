import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StoryDraft, StoryEdit } from '../api/story-drafts';
import { useApiBackoff } from '../api/ApiBackoff';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { DraftEditingButton } from './DraftEditorScreen';
import { draftEditingCopy } from './draft-editing-copy';

export interface DraftHistoryState {
  phase: 'loading' | 'ready' | 'loading-more' | 'error';
  draft: StoryDraft | null; items: StoryEdit[]; hasMore: boolean; bounded?: boolean; error?: StoryProjectsErrorKind;
}
export interface DraftHistoryScreenProps {
  language: Language; storyLanguage: Language; title: string; state: DraftHistoryState;
  onLoadMore: () => void; onRefresh: () => void; onBack: () => void; onSignOut: () => void;
}
export function DraftHistoryScreen(props: DraftHistoryScreenProps) {
  return <DraftHistoryView key={JSON.stringify([props.state.draft?.draft_id, props.state.draft?.revision])} {...props} />;
}
function DraftHistoryView({ language, storyLanguage, title, state, onLoadMore, onRefresh, onBack, onSignOut }: DraftHistoryScreenProps) {
  const text = draftEditingCopy[language], locale = accessibilityLanguages[language], contentLocale = accessibilityLanguages[storyLanguage];
  const { waiting } = useApiBackoff();
  const [selected, setSelected] = useState(0), [originalOpen, setOriginalOpen] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const noticeY = useRef(0), contentY = useRef(0), panelY = useRef(0);
  const busy = state.phase === 'loading' || state.phase === 'loading-more';
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const visible = state.phase !== 'loading' && !accessFailed && !!state.draft;
  const index = Math.min(selected, Math.max(0, state.items.length - 1));
  const item = visible ? state.items[index] : undefined;
  const message = state.error ? text.historyErrors[state.error]
    : state.phase === 'loading' ? text.historyLoading : state.phase === 'loading-more' ? text.loadingMore : null;
  useEffect(() => {
    if (!message) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
    if (state.error) scroll.current?.scrollTo({ y: Math.max(0, contentY.current + panelY.current + noticeY.current - 16), animated: false });
  }, [message, state.error]);
  const navigate = (next: number) => {
    if (busy) return;
    setSelected(next);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text.item + ' ' + (next + 1) + ' ' + text.of + ' ' + state.items.length);
  };
  return <Screen scrollViewRef={scroll} onContentLayout={event => { contentY.current = event.nativeEvent.layout.y; }}>
    <MemyBrand />
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.historyTitle}</Text>
    {!accessFailed && <Text accessibilityRole="header" accessibilityLanguage={contentLocale} allowFontScaling selectable style={styles.storyTitle}>{title}</Text>}
    <View style={styles.panel} accessibilityState={{ busy }} onLayout={event => { panelY.current = event.nativeEvent.layout.y; }}>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.historyIntro}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
      {message && <Text accessibilityRole={state.error ? 'alert' : undefined} accessibilityLanguage={locale}
        accessibilityLiveRegion="polite" allowFontScaling style={styles.notice}
        onLayout={event => { noticeY.current = event.nativeEvent.layout.y; }}>{message}</Text>}
      {visible && state.draft && <>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>
          {text.language}: {storyLanguage === 'sv' ? text.swedish : text.english}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>{text.loadedOnly}</Text>
        {state.bounded && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.historyBounded}</Text>}
        <DraftEditingButton language={language} label={originalOpen ? text.hideOriginal : text.showOriginal} expanded={originalOpen}
          onPress={() => setOriginalOpen(open => !open)} />
        {originalOpen && <View style={styles.card}>
          <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.original}</Text>
          <Text accessibilityLanguage={contentLocale} allowFontScaling selectable style={styles.wording}>{state.draft.original_content}</Text>
        </View>}
        {!item && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.emptyHistory}</Text>}
        {item && <View style={styles.card}>
          <Text accessibilityRole="header" accessibilityLanguage={locale} accessibilityLiveRegion="polite" allowFontScaling style={styles.label}>
            {text.item} {index + 1} {text.of} {state.items.length}
          </Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.revision}: {item.revision}</Text>
          <Text accessibilityLanguage={locale} allowFontScaling style={styles.help}>
            {text.savedAt}: {new Date(item.created_at).toLocaleString(locale)}
          </Text>
          <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.savedWording}</Text>
          <Text accessibilityLanguage={contentLocale} allowFontScaling selectable style={styles.wording}>{item.content}</Text>
          <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.label}>{text.previousWording}</Text>
          <Text accessibilityLanguage={contentLocale} allowFontScaling selectable style={styles.wording}>{item.previous_content}</Text>
          <DraftEditingButton language={language} label={text.previous} disabled={busy || index === 0} onPress={() => navigate(index - 1)} />
          <DraftEditingButton language={language} label={text.next} disabled={busy || index + 1 >= state.items.length}
            onPress={() => navigate(index + 1)} />
        </View>}
        {state.hasMore && <DraftEditingButton language={language} label={text.loadMore} primary disabled={waiting || busy || state.phase === 'error'} onPress={onLoadMore} />}
      </>}
      <DraftEditingButton language={language} label={text.refresh} primary={state.phase === 'error' && !accessFailed}
        disabled={waiting || busy || accessFailed} onPress={onRefresh} />
      <DraftEditingButton language={language} label={text.back} onPress={onBack} />
      <DraftEditingButton language={language} label={text.signOut} onPress={onSignOut} />
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  panel: { width: '100%', gap: 24 }, card: { width: '100%', gap: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  storyTitle: { color: colors.ink, fontFamily: headingFont, fontSize: 30, lineHeight: 40, textAlign: 'center', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  wording: { color: colors.ink, fontFamily: headingFont, fontSize: 23, lineHeight: 36, flexShrink: 1 },
  label: { color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  help: { color: colors.muted, fontSize: 20, lineHeight: 30, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper },
});
