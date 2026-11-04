import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { StoryEdit } from '../api/story-drafts';
import { useApiBackoff } from '../api/ApiBackoff';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import type { RealDraft, RealExport, RealMemory } from './api';
import { realCopy } from './copy';

export const storyContentCopy = {
  en: {
    reviewed: 'Memy remembered', allReviewed: 'You’ve checked these memories.',
    isCorrect: 'Is this right?', noMemories: 'No memories yet', noStory: 'Your story is waiting to be written',
    confirmed: 'Confirmed', leftOut: 'Left out', changeDecision: 'Change decision',
    saveCorrection: 'Save correction', aboutVersion: 'About this version',
    pdfShort: 'Opening sharing does not confirm the PDF was saved or sent.', pdfDetails: 'PDF details',
    shareMemory: 'Talk with Memy', reviewFirst: 'Check my memories',
    bookReady: 'Memy will use the memories you’ve checked to create your story.',
    pendingStory: 'Some memories still need your help. Your story will use only the ones you’ve checked.',
    aiUnavailable: 'Memy is unavailable right now. What you’ve saved is still here.',
    tryAgain: 'Try again', loading: 'Please wait…',
  },
  sv: {
    reviewed: 'Memy minns', allReviewed: 'Du har kontrollerat de här minnena.',
    isCorrect: 'Stämmer det här?', noMemories: 'Inga minnen ännu', noStory: 'Din berättelse väntar på att bli skriven',
    confirmed: 'Bekräftat', leftOut: 'Utelämnat', changeDecision: 'Ändra beslut',
    saveCorrection: 'Spara rättelse', aboutVersion: 'Om den här versionen',
    pdfShort: 'Att öppna delningen bekräftar inte att PDF-filen sparades eller skickades.', pdfDetails: 'Om PDF-delning',
    shareMemory: 'Prata med Memy', reviewFirst: 'Kontrollera mina minnen',
    bookReady: 'Memy använder minnena du har kontrollerat för att skapa din berättelse.',
    pendingStory: 'Några minnen behöver fortfarande din hjälp. Berättelsen använder bara de minnen du har kontrollerat.',
    aiUnavailable: 'Memy är inte tillgänglig just nu. Det du har sparat finns kvar.',
    tryAgain: 'Försök igen', loading: 'Vänta lite…',
  },
} as const;

function Button({ language, label, onPress, disabled = false, primary = false, quiet = false }: {
  language: Language; label: string; onPress(): void; disabled?: boolean; primary?: boolean; quiet?: boolean;
}) {
  return <LargeButton language={language} label={label} density="compact" onPress={onPress}
    disabled={disabled} variant={primary ? 'primary' : quiet ? 'tertiary' : 'secondary'} />;
}
function Note({ language, children }: PropsWithChildren<{ language: Language }>) {
  return <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.note}>{children}</Text>;
}

/** Keeps children mounted: hiding details must never erase controlled edits. */
function Disclosure({ language, label, children, open, onChange, onOpen, disabled = false }: PropsWithChildren<{
  language: Language; label: string; open?: boolean; onChange?(value: boolean): void; onOpen?(): void; disabled?: boolean;
}>) {
  const [localOpen, setLocalOpen] = useState(false), [focused, setFocused] = useState(false);
  const expanded = open ?? localOpen;
  return <View style={styles.section}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityLanguage={accessibilityLanguages[language]}
      accessibilityState={{ expanded, disabled }} disabled={disabled} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onPress={() => {
        if (disabled) return;
        const next = !expanded;
        if (onChange) onChange(next); else setLocalOpen(next);
        if (next) onOpen?.();
      }}
      style={({ pressed }) => [styles.disclosure, pressed && styles.pressed, focused && styles.focused, disabled && styles.disabled]}>
      <Text allowFontScaling style={styles.disclosureLabel}>{label}</Text>
      <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" allowFontScaling style={styles.marker}>{expanded ? '−' : '+'}</Text>
    </Pressable>
    <View accessibilityElementsHidden={!expanded} importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      style={[styles.section, !expanded && styles.hidden]}>{children}</View>
  </View>;
}

/** Deliberate, one-time read; retry is explicit and never used for a paid write. */
function ReadSection({ language, label, loaded, busy, disabled, onLoad, preview, children }: PropsWithChildren<{
  language: Language; label: string; loaded: boolean; busy: boolean; disabled: boolean; onLoad(): void; preview?: ReactNode;
}>) {
  const [attempted, setAttempted] = useState(false);
  const { waiting } = useApiBackoff();
  const copy = storyContentCopy[language];
  const blocked = disabled || waiting || busy;
  return <Disclosure language={language} label={label} disabled={!loaded && !preview && blocked} onOpen={() => {
    if (!loaded && !attempted && !blocked) { setAttempted(true); onLoad(); }
  }}>
    {preview}
    {loaded ? children : busy ? <Note language={language}>{copy.loading}</Note>
      : attempted && <Button language={language} label={copy.tryAgain} disabled={blocked} onPress={onLoad} />}
  </Disclosure>;
}

export interface MemoriesContentProps {
  language: Language; storyLanguage: Language; memories: RealMemory[]; corrections: Record<string, string>;
  blocked: boolean; busy: boolean;
  onBeginCorrection?(memory: RealMemory): void;
  onCorrection(id: string, value: string): void;
  onReview(memory: RealMemory, status: 'confirmed' | 'rejected'): void;
  onShareMemory(): void;
}
export function MemoriesContent(props: MemoriesContentProps) {
  const { language, memories, blocked, onReview, onShareMemory } = props;
  const t = realCopy[language], copy = storyContentCopy[language];
  const [reviewedOpen, setReviewedOpen] = useState(() => !memories.some(memory => memory.status === 'pending'));
  const pending = memories.filter(memory => memory.status === 'pending');
  const reviewed = memories.filter(memory => memory.status !== 'pending');
  const review = (memory: RealMemory, status: 'confirmed' | 'rejected') => {
    // Opening the destination group is presentation only. The card stays pending
    // until the owning controller receives a verified successful review result.
    setReviewedOpen(true); onReview(memory, status);
  };
  return <View style={styles.section}>
    {!!pending.length && <Note language={language}>{t.reviewNotice}</Note>}
    {!memories.length && <><Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{copy.noMemories}</Text><Note language={language}>{t.emptyMemories}</Note>
      <Button language={language} label={copy.shareMemory} onPress={onShareMemory} disabled={blocked} primary /></>}
    {!!pending.length && <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{t.pendingStatus}</Text>}
    {pending.map(memory => <MemoryCard key={memory.id} {...props} memory={memory} onReview={review} />)}
    {!!memories.length && !pending.length && <Note language={language}>{copy.allReviewed}</Note>}
    {!!reviewed.length && <Disclosure language={language} label={copy.reviewed} open={reviewedOpen} onChange={setReviewedOpen}>
      {reviewed.map(memory => <MemoryCard key={memory.id} {...props} memory={memory} onReview={review} />)}
    </Disclosure>}
  </View>;
}
function MemoryCard({ language, storyLanguage, memory, corrections, blocked, busy, onBeginCorrection, onCorrection, onReview }: MemoriesContentProps & { memory: RealMemory }) {
  const t = realCopy[language], copy = storyContentCopy[language];
  const [correcting, setCorrecting] = useState(false);
  const correction = corrections[memory.id] ?? '';
  const [changeFocused, setChangeFocused] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const roomyActions = fontScale >= 1.3 || width < 350;
  const toggleCorrection = () => {
    if (blocked) return;
    if (!correcting) onBeginCorrection?.(memory);
    setCorrecting(!correcting);
  };
  const actions = <>
    <View style={styles.memoryActions}>
      {!correcting && <View style={[styles.memoryAction, roomyActions && styles.roomyAction]}><Button language={language} label={correction.trim() ? copy.saveCorrection : t.confirm}
        onPress={() => onReview(memory, 'confirmed')} disabled={blocked} /></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={t.correctAction} accessibilityLanguage={accessibilityLanguages[language]}
        accessibilityState={{ expanded: correcting, disabled: blocked }} disabled={blocked}
        onFocus={() => setChangeFocused(true)} onBlur={() => setChangeFocused(false)} onPress={toggleCorrection}
        style={({ pressed }) => [styles.changeAction, roomyActions && styles.roomyAction, pressed && styles.pressed, changeFocused && styles.focused, blocked && styles.disabled]}>
        <Text allowFontScaling style={[styles.disclosureLabel, styles.changeLabel]}>{t.correctAction}</Text>
      </Pressable>
      <View style={[styles.memoryAction, roomyActions && styles.roomyAction]}><Button language={language} label={t.reject} onPress={() => onReview(memory, 'rejected')} disabled={blocked} quiet /></View>
    </View>
    <View accessibilityElementsHidden={!correcting} importantForAccessibility={correcting ? 'auto' : 'no-hide-descendants'}
      style={[styles.section, !correcting && styles.hidden]}>
      <TextInput accessibilityLabel={t.correct} accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
        placeholder={t.correct} value={correction} multiline maxLength={1000} editable={!blocked}
        style={styles.input} onChangeText={value => { if (!busy) onCorrection(memory.id, value); }} />
      <Button language={language} label={copy.saveCorrection} onPress={() => onReview(memory, 'confirmed')}
        disabled={blocked || !correction.trim()} primary />
    </View>
  </>;
  return <View style={memory.status === 'pending' ? styles.memory : styles.reviewedMemory}>
    <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.body}>{memory.corrected_value ?? memory.value}</Text>
    {memory.status === 'pending' ? <>
      {memory.clarification_question
        ? <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.body}>{memory.clarification_question}</Text>
        : <Note language={language}>{copy.isCorrect}</Note>}
      {actions}
    </> : <>
      <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.status}>
        {memory.status === 'confirmed' ? copy.confirmed : copy.leftOut}
      </Text>
      <Disclosure language={language} label={copy.changeDecision}>{actions}</Disclosure>
    </>}
    <Disclosure language={language} label={t.seeOriginal}>
      <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.quote}>{memory.evidence}</Text>
      {memory.clarification_question && memory.status !== 'pending' && <>
        <Note language={language}>{t.question}</Note>
        <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.body}>{memory.clarification_question}</Text>
      </>}
    </Disclosure>
  </View>;
}

export interface AutobiographyContentProps {
  language: Language; storyLanguage: Language; draft: RealDraft | null; drafts: RealDraft[]; memories: RealMemory[];
  editor: string | null; history: StoryEdit[] | null; exports: RealExport[] | null;
  blocked: boolean; busy: boolean; ambiguousEdit: boolean; usageBlocked: boolean; writingAvailable: boolean;
  privacyReady: boolean; privacyFailed: boolean; generationControls: ReactNode;
  memoriesLoading?: boolean; memoriesUnavailable?: boolean; historyLoading?: boolean; exportsLoading?: boolean;
  onEdit(): void; onChangeEditor(value: string): void; onSave(): void; onCancel(): void;
  onSelectDraft(draft: RealDraft): void; onLoadHistory(): void; onLoadExports(): void;
  onExport(): void; onDownloadExport(metadata: RealExport): void; onReviewMemories(): void; onShareMemory(): void;
}
export function AutobiographyContent(props: AutobiographyContentProps) {
  const { language, storyLanguage, draft, drafts, memories, editor, history, exports, blocked, busy, ambiguousEdit,
    usageBlocked, writingAvailable, privacyReady, privacyFailed, generationControls, memoriesLoading = false, memoriesUnavailable = false, historyLoading, exportsLoading,
    onEdit, onChangeEditor, onSave, onCancel, onSelectDraft, onLoadHistory, onLoadExports, onExport,
    onDownloadExport, onReviewMemories, onShareMemory } = props;
  const t = realCopy[language], copy = storyContentCopy[language];
  const canCreate = writingAvailable && !usageBlocked;
  const confirmed = memories.some(memory => memory.status === 'confirmed');
  const pendingHelp = memories.some(memory => memory.status === 'pending') && <>
    <Note language={language}>{copy.pendingStory}</Note>
    <Button language={language} label={copy.reviewFirst} onPress={onReviewMemories} disabled={blocked} quiet />
  </>;
  return <View style={styles.section}>
    {!draft && (memoriesLoading ? <Note language={language}>{t.loadingMemories}</Note> : memoriesUnavailable ? null : !memories.length ? <><Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.bookHeading}>{copy.noStory}</Text><Note language={language}>{t.emptyBook}</Note>
      <Button language={language} label={copy.shareMemory} onPress={onShareMemory} disabled={blocked} primary /></>
      : !confirmed ? <Button language={language} label={copy.reviewFirst} onPress={onReviewMemories} disabled={blocked} primary />
        : !canCreate ? <><Note language={language}>{copy.aiUnavailable}</Note>
          <Button language={language} label={t.memories} onPress={onReviewMemories} disabled={blocked} /></>
          : <>{pendingHelp}<Note language={language}>{copy.bookReady}</Note>{generationControls}</>)}
    {draft && <>
      <View style={styles.book}>
        {editor === null && <>
          <View style={styles.actions}>
            <View style={styles.action}><Button language={language} label={t.edit} onPress={onEdit} disabled={blocked} /></View>
            <View style={styles.action}><Button language={language} label={t.export} onPress={onExport}
              disabled={blocked || !privacyReady || privacyFailed} primary /></View>
          </View>
        </>}
        <Note language={language}>{t.reviewDraft}</Note>
        {draft.verification.status === 'stale_sources' && <Note language={language}>{t.stale}</Note>}
        {editor === null ? <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.prose}>{draft.content}</Text>
          : <>
            <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{t.editor}</Text>
            <TextInput accessibilityLabel={t.editor} accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling value={editor}
              multiline maxLength={20_000} editable={!busy && !ambiguousEdit} style={[styles.input, styles.editor]} onChangeText={onChangeEditor} />
            <Button language={language} label={t.save} onPress={onSave} disabled={blocked || !editor.trim() || editor === draft.content} primary />
            <Button language={language} label={t.cancel} onPress={onCancel} disabled={busy} />
          </>}
      </View>
      <Disclosure language={language} label={copy.aboutVersion}>
        <Note language={language}>{t.version} {draft.version} · {t.revision} {draft.revision}</Note>
        <Note language={language}>{t.modelReview}</Note>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{t.sources}</Text>
        {draft.source_memories.map(source => <View key={source.memory_id} style={styles.source}>
          <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.body}>{source.corrected_value ?? source.value}</Text>
          <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.quote}>{source.evidence}</Text>
        </View>)}
      </Disclosure>
      <ReadSection language={language} label={t.historySection} loaded={history !== null} busy={historyLoading ?? busy}
        disabled={blocked || editor !== null} onLoad={onLoadHistory} preview={drafts.length > 1 ? <View style={styles.section}>
          {drafts.map(item => <Button key={item.draft_id} language={language}
            label={`${t.version} ${item.version} · ${t.revision} ${item.revision}`} disabled={blocked || editor !== null}
            onPress={() => onSelectDraft(item)} quiet />)}
        </View> : undefined}>
        {!history?.length && <Note language={language}>{t.noHistory}</Note>}
        {history?.map(item => <View key={item.id} style={styles.source}>
          <Note language={language}>{t.revision} {item.revision}</Note>
          <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.body}>{item.content}</Text>
        </View>)}
      </ReadSection>
      <Disclosure language={language} label={copy.pdfDetails}><Note language={language}>{copy.pdfShort}</Note><Note language={language}>{t.pdfNotice}</Note></Disclosure>
      {!memoriesUnavailable && <Disclosure language={language} label={t.createVersion}>
        {memoriesLoading ? <Note language={language}>{t.loadingMemories}</Note> : !canCreate ? <Note language={language}>{copy.aiUnavailable}</Note> : !confirmed ? <Button language={language} label={copy.reviewFirst} onPress={onReviewMemories} disabled={blocked} primary /> : <>{pendingHelp}{generationControls}</>}
      </Disclosure>}
    </>}
    <ReadSection language={language} label={t.pdfVersions} loaded={exports !== null} busy={exportsLoading ?? busy}
      disabled={blocked || editor !== null} onLoad={onLoadExports}>
      {!exports?.length && <Note language={language}>{t.noExports}</Note>}
      {exports?.map(item => <View key={item.export_id} style={styles.source}>
        <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.heading}>{item.title}</Text>
        <Note language={language}>{t.version} {item.draft_version} · {t.revision} {item.draft_revision}</Note>
        <Button language={language} label={t.download} onPress={() => onDownloadExport(item)} disabled={blocked || editor !== null || !privacyReady || privacyFailed} />
      </View>)}
    </ReadSection>
  </View>;
}

const styles = StyleSheet.create({
  section: { width: '100%', gap: 16 },
  book: { width: '100%', gap: 20, paddingBottom: 12 },
  memory: { width: '100%', gap: 12, paddingVertical: 20, borderBottomWidth: 1, borderColor: colors.border },
  reviewedMemory: { width: '100%', gap: 8, paddingTop: 16 },
  memoryActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  memoryAction: { flexGrow: 1, flexBasis: 80, maxWidth: '100%' },
  roomyAction: { flexBasis: 140 },
  changeAction: { minHeight: layout.minimumTouchTarget, minWidth: layout.minimumTouchTarget, flexGrow: 1, flexBasis: 80,
    maxWidth: '100%', flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, action: { flexGrow: 1, flexBasis: 140, maxWidth: '100%' },
  bookHeading: { color: colors.ink, fontFamily: headingFont, fontSize: 28, lineHeight: 38, flexShrink: 1 },
  heading: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 21, lineHeight: 33, flexShrink: 1 },
  note: { color: colors.muted, fontSize: 17, lineHeight: 27, flexShrink: 1 },
  status: { color: colors.forest, fontSize: 17, lineHeight: 26, fontWeight: '600', flexShrink: 1 },
  quote: { color: colors.muted, fontSize: 18, lineHeight: 29, borderLeftWidth: 2, borderColor: colors.border, paddingLeft: 12, flexShrink: 1 },
  source: { gap: 12, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border },
  prose: { color: colors.ink, fontFamily: headingFont, fontSize: 22, lineHeight: 36, flexShrink: 1 },
  input: { color: colors.ink, fontSize: 21, lineHeight: 33, minHeight: 80, textAlignVertical: 'top', padding: 14,
    borderRadius: 16, borderWidth: 1, borderColor: colors.forest, backgroundColor: colors.cream }, editor: { minHeight: 320 },
  disclosure: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 10, paddingHorizontal: 2,
    flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: colors.border },
  disclosureLabel: { flex: 1, flexShrink: 1, color: colors.forest, fontSize: 21, lineHeight: 31, fontWeight: '600' },
  changeLabel: { textAlign: 'center' },
  marker: { color: colors.forest, fontSize: 24, lineHeight: 32 }, hidden: { display: 'none' },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink, backgroundColor: colors.selected }, disabled: { opacity: 0.65 },
});
