import { useEffect, useRef, useState } from 'react';
import { useApiBackoff } from '../api/ApiBackoff';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StoryDraft } from '../api/story-drafts';
import type { StoryProjectsErrorKind } from '../api/story-projects';
import { MemyBrand } from '../components/BrandArtwork';
import { Screen, screenStyles } from '../components/Screen';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, layout } from '../theme';
import { generationBrowserCopy } from './generation-browser-copy';

export interface GenerationBrowserState {
  phase: 'loading' | 'ready' | 'checking' | 'error';
  items: StoryDraft[]; hasMore: boolean; bounded?: boolean; error?: StoryProjectsErrorKind;
}
export interface GenerationBrowserScreenProps {
  language: Language; storyLanguage: Language; title: string; selectedDraftId: string | null;
  state: GenerationBrowserState; onOpen: (draftId: string) => void; onLoadMore: () => void;
  onRefresh: () => void; onBack: () => void; onSignOut: () => void;
}
function Button({ language, label, onPress, disabled = false, primary = false }: {
  language: Language; label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
    accessibilityState={{ disabled }} disabled={disabled} onPress={() => { if (!disabled) onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, primary && styles.primary, disabled && styles.disabled,
      disabled && primary && styles.disabledPrimary, focused && styles.focused, pressed && !disabled && styles.focused]}>
    <Text allowFontScaling style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
  </Pressable>;
}
export function GenerationBrowserScreen(props: GenerationBrowserScreenProps) {
  // Appending a page retains position. A deliberately refreshed list begins at its first generation.
  const anchor = props.state.items[0];
  return <BrowserView key={anchor ? `${anchor.draft_id}:${anchor.revision}` : 'empty'} {...props} />;
}
function BrowserView({ language, storyLanguage, title, selectedDraftId, state, onOpen, onLoadMore,
  onRefresh, onBack, onSignOut }: GenerationBrowserScreenProps) {
  const text = generationBrowserCopy[language], locale = accessibilityLanguages[language];
  const { waiting } = useApiBackoff();
  const [position, setPosition] = useState(0), sent = useRef(false);
  const busy = state.phase === 'loading' || state.phase === 'checking';
  const accessFailed = ['authentication', 'forbidden', 'not-found'].includes(state.error ?? '');
  const items = accessFailed || state.phase === 'loading' ? [] : state.items;
  const index = Math.min(position, Math.max(0, items.length - 1)), item = items[index];
  const actionable = state.phase === 'ready' && !state.error && !accessFailed;
  const message = state.error ? text.errors[state.error] : state.phase === 'loading' ? text.loading
    : state.phase === 'checking' ? text.checking : null;
  useEffect(() => { sent.current = false; }, [state.phase, state.items]);
  useEffect(() => {
    if (Platform.OS === 'ios' && message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  const move = (next: number) => {
    if (!actionable || next < 0 || next >= items.length) return;
    setPosition(next);
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(`${text.position} ${next + 1} ${text.of} ${items.length}`);
  };
  const open = () => { if (!waiting && item && actionable && !sent.current) { sent.current = true; onOpen(item.draft_id); } };
  return <Screen>
    <MemyBrand />
    <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={screenStyles.heading}>{text.title}</Text>
    {!accessFailed && <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[storyLanguage]}
      allowFontScaling selectable style={styles.storyTitle}>{title}</Text>}
    <View style={styles.panel} accessibilityState={{ busy }}>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.introduction}</Text>
      <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.simulation}</Text>
      {message && <Text accessibilityRole={state.error ? 'alert' : undefined} accessibilityLiveRegion="polite"
        accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{message}</Text>}
      {state.phase === 'ready' && !item && !state.error && <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.empty}</Text>}
      {item && <View style={styles.card}>
        <Text accessibilityRole="header" accessibilityLanguage={locale} allowFontScaling style={styles.subheading}>
          {text.position} {index + 1} {text.of} {items.length}
        </Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.generation}: {item.version}</Text>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.revision}: {item.revision}</Text>
        {item.draft_id === selectedDraftId && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.selected}</Text>}
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.verification}: {
          item.verification.method === 'manual_unverified' ? text.manual
            : item.verification.sources_current ? text.reviewed : text.stale
        }</Text>
        <Button language={language} label={text.open} primary disabled={waiting || !actionable} onPress={open} />
        <Button language={language} label={text.previous} disabled={!actionable || index === 0} onPress={() => move(index - 1)} />
        <Button language={language} label={text.next} disabled={!actionable || index + 1 >= items.length} onPress={() => move(index + 1)} />
      </View>}
      {!accessFailed && state.bounded && <Text accessibilityLanguage={locale} allowFontScaling style={styles.notice}>{text.bounded}</Text>}
      {!accessFailed && state.hasMore && !state.bounded && <>
        <Text accessibilityLanguage={locale} allowFontScaling style={styles.body}>{text.incomplete}</Text>
        <Button language={language} label={text.more} disabled={waiting || !actionable} onPress={onLoadMore} />
      </>}
      <Button language={language} label={text.refresh} disabled={waiting || busy || accessFailed} onPress={onRefresh} />
      <Button language={language} label={text.back} onPress={onBack} />
      <Button language={language} label={text.signOut} onPress={onSignOut} />
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  panel: { width: '100%', gap: 24 },
  storyTitle: { color: colors.ink, fontSize: 28, lineHeight: 38, textAlign: 'center', flexShrink: 1 },
  card: { width: '100%', gap: 20, padding: 16, borderWidth: 1, borderColor: colors.border,
    borderRadius: layout.controlRadius, backgroundColor: colors.paper },
  subheading: { color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 22, lineHeight: 32, flexShrink: 1 },
  notice: { color: colors.ink, fontSize: 22, lineHeight: 32, padding: 16, borderWidth: 2,
    borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper, flexShrink: 1 },
  button: { width: '100%', minHeight: layout.minimumTouchTarget, paddingVertical: 16, paddingHorizontal: 24,
    borderWidth: 2, borderColor: colors.forest, borderRadius: layout.controlRadius, backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.forest }, disabled: { borderColor: colors.muted },
  disabledPrimary: { backgroundColor: colors.muted }, focused: { borderColor: colors.ink },
  buttonText: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  primaryText: { color: colors.paper },
});
