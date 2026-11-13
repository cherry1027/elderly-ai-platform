import { StoryCover } from '../components/StoryCover';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { StoryEdit } from '../api/story-drafts';
import { useApiBackoff } from '../api/ApiBackoff';
import { LargeButton } from '../components/LargeButton';
import { accessibilityLanguages, type Language } from '../i18n';
import { colors, headingFont, layout } from '../theme';
import { MAX_MEMORY_EXCERPT, type RealDraft, type RealExport, type RealMemory, type RealMessage } from './api';
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
    pendingStory: 'You can check more suggestions now. Your story will use the memories you’ve confirmed.',
    answerFirst: 'Answer the open questions in Memories before creating a new draft. Choose Yes, Change, or Leave out for each question.',
    confirmFirst: 'Confirm at least one memory before creating your story.',
    startStory: 'Go to My Story',
    useSavedWords: 'Use your saved words',
    savedWordsHelp: 'Choose words you have already shared. Saving an excerpt confirms it as a memory.',
    savedWordsEmpty: 'There are no saved messages from you in this conversation yet.',
    savedWordsConflict: 'This excerpt may already be saved, edited, or left out. Open Memories to check.',
    saveAsMemory: 'Save as a memory', savedAsMemory: 'Saved as a memory',
    partialWords: 'This shows up to the first 1,000 characters. Your full message stays saved.',
    backToStory: 'Back to My Story', backToMemories: 'Back to Memories',
    savedWordsNext: 'Go to My Story, confirm you want to use AI, then choose Create My Story.',
    noMemoriesForDraft: 'A draft and PDF need at least one confirmed memory. You can use your saved words or share a new detail.',
    memorySaved: 'Memory confirmed and saved.', memoryOmitted: 'Saved. This memory is left out of new drafts.',
    reviewProgress: (count: number) => count === 1 ? '1 memory confirmed' : `${count} memories confirmed`,
    draftHeading: 'Your story draft', downloadPdf: 'Download PDF', downloadSavedPdf: 'Download saved PDF',
    draftSourceCount: (count: number) => `Memy had ${count} confirmed ${count === 1 ? 'memory' : 'memories'} when it wrote this draft.`,
    draftMemoryUpdates: (count: number) => count === 1 ? '1 confirmed memory is new or has changed since this draft.'
      : `${count} confirmed memories are new or have changed since this draft.`,
    updateMyStory: 'Update My Story',
    browserPdf: 'Look for the PDF in your browser’s downloads or Files on your phone.',
    aiUnavailable: 'Memy is unavailable right now. What you’ve saved is still here.',
    tryAgain: 'Try again', loading: 'Please wait…',
  },
  sv: {
    reviewed: 'Minna minns', allReviewed: 'Du har kontrollerat de här minnena.',
    isCorrect: 'Stämmer det här?', noMemories: 'Inga minnen ännu', noStory: 'Din berättelse väntar på att bli skriven',
    confirmed: 'Bekräftat', leftOut: 'Utelämnat', changeDecision: 'Ändra beslut',
    saveCorrection: 'Spara rättelse', aboutVersion: 'Om den här versionen',
    pdfShort: 'Att öppna delningen bekräftar inte att PDF-filen sparades eller skickades.', pdfDetails: 'Om PDF-delning',
    shareMemory: 'Berätta för Minna', reviewFirst: 'Kontrollera mina minnen',
    bookReady: 'Minna använder minnena du har kontrollerat för att skapa din berättelse.',
    pendingStory: 'Du kan kontrollera fler förslag nu. Berättelsen använder de minnen du har bekräftat.',
    answerFirst: 'Svara på öppna frågor under Minnen innan du skapar ett nytt utkast. Välj Ja, Ändra eller Utelämna för varje fråga.',
    confirmFirst: 'Bekräfta minst ett minne innan du skapar din berättelse.',
    startStory: 'Gå till Min berättelse',
    useSavedWords: 'Använd dina sparade ord',
    savedWordsHelp: 'Välj bland de ord du redan har delat. När du sparar ett utdrag bekräftas det som ett minne.',
    savedWordsEmpty: 'Det finns ännu inga sparade meddelanden från dig i det här samtalet.',
    savedWordsConflict: 'Utdraget kan redan ha sparats, ändrats eller utelämnats. Titta under Minnen.',
    saveAsMemory: 'Spara som minne', savedAsMemory: 'Sparat som minne',
    partialWords: 'Här visas upp till de första 1 000 tecknen. Hela meddelandet finns kvar.',
    backToStory: 'Tillbaka till Min berättelse', backToMemories: 'Tillbaka till Minnen',
    savedWordsNext: 'Gå till Min berättelse, bekräfta att du vill använda AI och välj Skapa min berättelse.',
    noMemoriesForDraft: 'För att skapa ett utkast och en PDF behövs minst ett bekräftat minne. Använd dina sparade ord eller berätta något nytt.',
    memorySaved: 'Minnet har bekräftats och sparats.', memoryOmitted: 'Sparat. Minnet utelämnas från nya utkast.',
    reviewProgress: (count: number) => count === 1 ? '1 bekräftat minne' : `${count} bekräftade minnen`,
    draftHeading: 'Ditt berättelseutkast', downloadPdf: 'Ladda ner PDF', downloadSavedPdf: 'Ladda ner sparad PDF',
    draftSourceCount: (count: number) => `Minna hade ${count} ${count === 1 ? 'bekräftat minne' : 'bekräftade minnen'} när det här utkastet skrevs.`,
    draftMemoryUpdates: (count: number) => count === 1 ? '1 bekräftat minne har tillkommit eller ändrats sedan utkastet skrevs.'
      : `${count} bekräftade minnen har tillkommit eller ändrats sedan utkastet skrevs.`,
    updateMyStory: 'Uppdatera min berättelse',
    browserPdf: 'Leta efter PDF-filen bland hämtade filer i webbläsaren eller i Filer på mobilen.',
    aiUnavailable: 'Minna är inte tillgänglig just nu. Det du har sparat finns kvar.',
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

function messageExcerpt(text: string): { excerpt: string; partial: boolean } {
  const characters = [...text.trim()];
  return { excerpt: characters.slice(0, MAX_MEMORY_EXCERPT).join('').trimEnd(),
    partial: characters.length > MAX_MEMORY_EXCERPT };
}

export function isSavedMessageMemory(memory: RealMemory, message: RealMessage, excerpt: string): boolean {
  return memory.source_message_id === message.id && memory.status === 'confirmed' &&
    memory.evidence === excerpt && memory.value === excerpt && memory.corrected_value === null;
}

export function SavedWordsContent({ language, storyLanguage, messages, memories, blocked, loaded, onSave, onShareMemory }: {
  language: Language; storyLanguage: Language; messages: RealMessage[]; memories: RealMemory[];
  blocked: boolean; loaded: boolean; onSave(message: RealMessage, excerpt: string): void; onShareMemory(): void;
}) {
  const copy = storyContentCopy[language];
  const originals = messages.filter(message => message.role === 'user');
  return <View style={styles.section}>
    <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]}
      allowFontScaling style={styles.heading}>{copy.useSavedWords}</Text>
    <Note language={language}>{copy.savedWordsHelp}</Note>
    {loaded && originals.length === 0 && <>
      <Note language={language}>{copy.savedWordsEmpty}</Note>
      <Button language={language} label={copy.shareMemory} onPress={onShareMemory} disabled={blocked} primary />
    </>}
    {originals.map(message => {
      const { excerpt, partial } = messageExcerpt(message.text);
      const saved = memories.some(memory => isSavedMessageMemory(memory, message, excerpt));
      return <View key={message.id} style={styles.source}>
        <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.body}>{excerpt}</Text>
        {partial && <Note language={language}>{copy.partialWords}</Note>}
        {saved ? <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
          allowFontScaling style={styles.status}>{copy.savedAsMemory}</Text>
          : <Button language={language} label={copy.saveAsMemory} onPress={() => onSave(message, excerpt)} disabled={blocked} />}
      </View>;
    })}
  </View>;
}

export interface MemoriesContentProps {
  language: Language; storyLanguage: Language; memories: RealMemory[]; corrections: Record<string, string>;
  blocked: boolean; busy: boolean;
  onBeginCorrection?(memory: RealMemory): void;
  onCorrection(id: string, value: string): void;
  onReview(memory: RealMemory, status: 'confirmed' | 'rejected'): void;
  onShareMemory(): void;
  onOpenStory?(): void;
  onUseSavedWords?(): void;
}
export function MemoriesContent(props: MemoriesContentProps) {
  const { language, storyLanguage, memories, corrections, blocked, busy, onShareMemory, onOpenStory, onUseSavedWords } = props;
  const t = realCopy[language], copy = storyContentCopy[language];
  const [reviewedOpen, setReviewedOpen] = useState(() => !memories.some(memory => memory.status === 'pending'));
  const [lastReview, setLastReview] = useState<{ id: string; version: number; status: 'confirmed' | 'rejected' } | null>(null);
  const { pending, reviewed, byId, confirmedCount } = useMemo(() => {
    const pending: RealMemory[] = [], reviewed: RealMemory[] = [], byId = new Map<string, RealMemory>();
    let confirmedCount = 0;
    for (const memory of memories) {
      byId.set(memory.id, memory);
      (memory.status === 'pending' ? pending : reviewed).push(memory);
      if (memory.status === 'confirmed') confirmedCount += 1;
    }
    return { pending, reviewed, byId, confirmedCount };
  }, [memories]);
  const lastReviewedMemory = lastReview && byId.get(lastReview.id);
  const savedReview = lastReview && lastReviewedMemory?.version === lastReview.version + 1 && lastReviewedMemory.status === lastReview.status;
  const inlineReview = savedReview && pending.length > 0 ? lastReviewedMemory : null;
  const reviewQueue = inlineReview ? memories.filter(memory => memory.status === 'pending' || memory.id === inlineReview.id) : pending;
  const priorReviews = inlineReview ? reviewed.filter(memory => memory.id !== inlineReview.id) : reviewed;
  const hasOpenQuestions = pending.some(memory => memory.clarification_question !== null);
  // Presentation-only event bridges let unchanged cards skip correction
  // keystrokes. Always resolve the current controller and exact owned row.
  const latest = useRef<(MemoriesContentProps & { byId: Map<string, RealMemory> }) | null>({ ...props, byId });
  useLayoutEffect(() => { latest.current = { ...props, byId }; });
  useLayoutEffect(() => () => { latest.current = null; }, []);
  const beginCorrection = useCallback((memory: RealMemory) => {
    const current = latest.current;
    if (!current || current.blocked || current.byId.get(memory.id) !== memory) return;
    current.onBeginCorrection?.(memory);
  }, []);
  const correct = useCallback((memory: RealMemory, value: string) => {
    const current = latest.current;
    if (!current || current.blocked || current.busy || current.byId.get(memory.id) !== memory) return;
    current.onCorrection(memory.id, value);
  }, []);
  const review = useCallback((memory: RealMemory, status: 'confirmed' | 'rejected') => {
    const current = latest.current;
    if (!current || current.blocked || current.byId.get(memory.id) !== memory) return;
    // The card stays pending until the controller verifies the saved result.
    setLastReview({ id: memory.id, version: memory.version, status });
    setReviewedOpen(true);
    current.onReview(memory, status);
  }, []);
  const card = (memory: RealMemory) => <MemoryCard key={memory.id} language={language} storyLanguage={storyLanguage}
    memory={memory} correction={corrections[memory.id] ?? ''} blocked={blocked} busy={busy}
    onBeginCorrection={beginCorrection} onCorrection={correct} onReview={review} />;
  return <View style={styles.section}>
    {!!pending.length && <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{t.pendingStatus}</Text>}
    {memories.length > 0 && <View style={styles.progress}>
      {savedReview && <Text accessibilityLiveRegion="polite" accessibilityLanguage={accessibilityLanguages[language]}
        allowFontScaling style={styles.status}>{lastReview.status === 'confirmed' ? copy.memorySaved : copy.memoryOmitted}</Text>}
      <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{copy.reviewProgress(confirmedCount)}</Text>
      {confirmedCount > 0 && !hasOpenQuestions && onOpenStory && <>
        <Note language={language}>{copy.bookReady}</Note>
        <Button language={language} label={copy.startStory} onPress={onOpenStory} disabled={blocked} primary />
      </>}
    </View>}
    {!!pending.length && <Note language={language}>{t.reviewNotice}</Note>}
    {!memories.length && <><Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{copy.noMemories}</Text><Note language={language}>{t.emptyMemories}</Note>
      <Button language={language} label={copy.shareMemory} onPress={onShareMemory} disabled={blocked} primary /></>}
    {onUseSavedWords &&
      <Button language={language} label={copy.useSavedWords} onPress={onUseSavedWords} disabled={blocked} />}
    {reviewQueue.map(card)}
    {!!memories.length && !pending.length && <Note language={language}>{copy.allReviewed}</Note>}
    {!!priorReviews.length && <Disclosure language={language} label={copy.reviewed} open={reviewedOpen} onChange={setReviewedOpen}>
      {priorReviews.map(card)}
    </Disclosure>}
  </View>;
}
interface MemoryCardProps {
  language: Language; storyLanguage: Language; memory: RealMemory; correction: string; blocked: boolean; busy: boolean;
  onBeginCorrection(memory: RealMemory): void; onCorrection(memory: RealMemory, value: string): void;
  onReview(memory: RealMemory, status: 'confirmed' | 'rejected'): void;
}
const MemoryCard = memo(function MemoryCard({ language, storyLanguage, memory, correction, blocked, busy, onBeginCorrection, onCorrection, onReview }: MemoryCardProps) {
  const t = realCopy[language], copy = storyContentCopy[language];
  const [correctionVersion, setCorrectionVersion] = useState<number | null>(null);
  const [changeFocused, setChangeFocused] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const roomyActions = fontScale >= 1.3 || width < 350;
  const correcting = correctionVersion !== null && (correctionVersion === memory.version || !!correction);
  const question = memory.clarification_question?.trim();
  // Legacy questions can contain a field label or a single word.
  const readableQuestion = question && /\s/.test(question) && question.endsWith('?') ? question : null;
  const correctionUnchanged = memory.status === 'confirmed' && correction.trim() === memory.corrected_value;
  const toggleCorrection = () => {
    if (blocked) return;
    if (!correcting) onBeginCorrection?.(memory);
    setCorrectionVersion(correcting ? null : memory.version);
  };
  const actions = <>
    <View style={styles.memoryActions}>
      {!correcting && memory.status !== 'confirmed' && <View style={[styles.memoryAction, roomyActions && styles.roomyAction]}><Button language={language} label={correction.trim() ? copy.saveCorrection : t.confirm}
        onPress={() => onReview(memory, 'confirmed')} disabled={blocked} primary /></View>}
      <Pressable accessibilityRole="button" accessibilityLabel={t.correctAction} accessibilityLanguage={accessibilityLanguages[language]}
        accessibilityState={{ expanded: correcting, disabled: blocked }} disabled={blocked}
        onFocus={() => setChangeFocused(true)} onBlur={() => setChangeFocused(false)} onPress={toggleCorrection}
        style={({ pressed }) => [styles.changeAction, roomyActions && styles.roomyAction, pressed && styles.pressed, changeFocused && styles.focused, blocked && styles.disabled]}>
        <Text allowFontScaling style={[styles.disclosureLabel, styles.changeLabel]}>{t.correctAction}</Text>
      </Pressable>
      {memory.status !== 'rejected' && <View style={[styles.memoryAction, roomyActions && styles.roomyAction]}><Button language={language} label={t.reject} onPress={() => onReview(memory, 'rejected')} disabled={blocked} quiet /></View>}
    </View>
    <View accessibilityElementsHidden={!correcting} importantForAccessibility={correcting ? 'auto' : 'no-hide-descendants'}
      style={[styles.section, !correcting && styles.hidden]}>
      <TextInput accessibilityLabel={t.correct} accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling
        placeholder={t.correct} value={correction} multiline maxLength={1000} editable={!blocked}
        style={styles.input} onChangeText={value => { if (!busy) onCorrection(memory, value); }} />
      <Button language={language} label={copy.saveCorrection} onPress={() => onReview(memory, 'confirmed')}
        disabled={blocked || !correction.trim() || correctionUnchanged} primary />
    </View>
  </>;
  return <View style={memory.status === 'pending' ? styles.memory : styles.reviewedMemory}>
    <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.body}>{memory.corrected_value ?? memory.value}</Text>
    {memory.status === 'pending' ? <>
      {readableQuestion && <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.body}>{readableQuestion}</Text>}
      <Note language={language}>{copy.isCorrect}</Note>
      {actions}
    </> : <>
      <Text accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.status}>
        {memory.status === 'confirmed' ? copy.confirmed : copy.leftOut}
      </Text>
      <Disclosure language={language} label={copy.changeDecision}>{actions}</Disclosure>
    </>}
    <Disclosure language={language} label={t.seeOriginal}>
      <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.quote}>{memory.evidence}</Text>
      {readableQuestion && memory.status !== 'pending' && <>
        <Note language={language}>{t.question}</Note>
        <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.body}>{readableQuestion}</Text>
      </>}
    </Disclosure>
  </View>;
});

const DraftSources = memo(function DraftSources({ sources, storyLanguage }: { sources: RealDraft['source_memories']; storyLanguage: Language }) {
  return <>{sources.map(source => <View key={source.memory_id} style={styles.source}>
    <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.body}>{source.corrected_value ?? source.value}</Text>
    <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.quote}>{source.evidence}</Text>
  </View>)}</>;
});
const SavedEditHistory = memo(function SavedEditHistory({ history, language, storyLanguage }: { history: StoryEdit[] | null; language: Language; storyLanguage: Language }) {
  const t = realCopy[language];
  return <>{!history?.length && <Note language={language}>{t.noHistory}</Note>}
    {history?.map(item => <View key={item.id} style={styles.source}>
      <Note language={language}>{t.revision} {item.revision}</Note>
      <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling selectable style={styles.body}>{item.content}</Text>
    </View>)}
  </>;
});

export interface AutobiographyContentProps {
  language: Language; storyLanguage: Language; draft: RealDraft | null; drafts: RealDraft[]; memories: RealMemory[];
  editor: string | null; history: StoryEdit[] | null; exports: RealExport[] | null;
  blocked: boolean; busy: boolean; ambiguousEdit: boolean; usageBlocked: boolean; writingAvailable: boolean;
  privacyReady: boolean; privacyFailed: boolean; generationControls: ReactNode;
  memoriesLoading?: boolean; memoriesUnavailable?: boolean; historyLoading?: boolean; exportsLoading?: boolean;
  onEdit(): void; onChangeEditor(value: string): void; onSave(): void; onCancel(): void;
  onSelectDraft(draft: RealDraft): void; onLoadHistory(): void; onLoadExports(): void;
  onExport(): void; onDownloadExport(metadata: RealExport): void; onReviewMemories(): void; onShareMemory(): void;
  onUseSavedWords?(): void;
}
export function AutobiographyContent(props: AutobiographyContentProps) {
  const { language, storyLanguage, draft, drafts, memories, editor, history, exports, blocked, busy, ambiguousEdit,
    usageBlocked, writingAvailable, privacyReady, privacyFailed, generationControls, memoriesLoading = false, memoriesUnavailable = false, historyLoading, exportsLoading,
    onEdit, onChangeEditor, onSave, onCancel, onSelectDraft, onLoadHistory, onLoadExports, onExport,
    onDownloadExport, onReviewMemories, onShareMemory, onUseSavedWords } = props;
  const t = realCopy[language], copy = storyContentCopy[language];
  const web = Platform.OS === 'web';
  const [versionOpen, setVersionOpen] = useState(false);
  const canCreate = writingAvailable && !usageBlocked;
  const confirmed = memories.some(memory => memory.status === 'confirmed');
  const pending = memories.filter(memory => memory.status === 'pending');
  const questionsOpen = pending.some(memory => memory.clarification_question !== null);
  const updatedMemoryCount = useMemo(() => {
    if (!draft || !memories.length) return 0;
    const sourceVersions = new Map<string, number>();
    for (const source of draft.source_memories) sourceVersions.set(source.memory_id, source.memory_version);
    return memories.filter(memory => memory.status === 'confirmed' &&
      memory.version > (sourceVersions.get(memory.id) ?? 0)).length;
  }, [draft, memories]);
  const showUpdate = updatedMemoryCount > 0 && !memoriesLoading && !memoriesUnavailable && editor === null;
  const savedWordsAction = onUseSavedWords &&
    <Button language={language} label={copy.useSavedWords} onPress={onUseSavedWords} disabled={blocked} primary={!memories.length} />;
  const creation = memoriesLoading ? <Note language={language}>{t.loadingMemories}</Note>
    : questionsOpen || !confirmed ? <>
      <Note language={language}>{questionsOpen ? copy.answerFirst : copy.confirmFirst}</Note>
      <Button language={language} label={copy.reviewFirst} onPress={onReviewMemories} disabled={blocked} primary />
      {!confirmed && savedWordsAction}
    </> : !canCreate ? <><Note language={language}>{copy.aiUnavailable}</Note>
      <Button language={language} label={t.memories} onPress={onReviewMemories} disabled={blocked} /></>
      : <>
        {pending.length > 0 ? <>
          <Note language={language}>{copy.pendingStory}</Note>
          <Button language={language} label={copy.reviewFirst} onPress={onReviewMemories} disabled={blocked} quiet />
        </> : <Note language={language}>{copy.bookReady}</Note>}
        {generationControls}
      </>;
  return <View style={styles.section}>
    {!draft && (memoriesUnavailable ? null : !memoriesLoading && !memories.length ? <><Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.bookHeading}>{copy.noStory}</Text><Note language={language}>{onUseSavedWords ? copy.noMemoriesForDraft : t.emptyBook}</Note>
      {savedWordsAction}
      <Button language={language} label={copy.shareMemory} onPress={onShareMemory} disabled={blocked} primary={!onUseSavedWords} /></>
      : creation)}
    {draft && <>
      <View style={styles.book}>
        <StoryCover />
        <View style={styles.draftHeader}>
          <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.bookHeading}>{copy.draftHeading}</Text>
        </View>
        {showUpdate && <View style={styles.progress}>
          <Note language={language}>{copy.draftMemoryUpdates(updatedMemoryCount)}</Note>
          <Disclosure language={language} label={copy.updateMyStory} open={versionOpen} onChange={setVersionOpen}>{creation}</Disclosure>
        </View>}
        {editor === null && <>
          <View style={styles.actions}>
            <View style={styles.action}><Button language={language} label={t.edit} onPress={onEdit} disabled={blocked} /></View>
            <View style={styles.action}><Button language={language} label={web ? copy.downloadPdf : t.export} onPress={onExport}
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
          <Note language={language}>{copy.draftSourceCount(draft.source_memories.length)}</Note>

        <Note language={language}>{t.modelReview}</Note>
        <Text accessibilityRole="header" accessibilityLanguage={accessibilityLanguages[language]} allowFontScaling style={styles.heading}>{t.sources}</Text>
        <DraftSources sources={draft.source_memories} storyLanguage={storyLanguage} />
      </Disclosure>
      <ReadSection language={language} label={t.historySection} loaded={history !== null} busy={historyLoading ?? busy}
        disabled={blocked || editor !== null} onLoad={onLoadHistory} preview={drafts.length > 1 ? <View style={styles.section}>
          {drafts.map(item => <Button key={item.draft_id} language={language}
            label={`${t.version} ${item.version} · ${t.revision} ${item.revision}`} disabled={blocked || editor !== null}
            onPress={() => onSelectDraft(item)} quiet />)}
        </View> : undefined}>
        <SavedEditHistory history={history} language={language} storyLanguage={storyLanguage} />
      </ReadSection>
      <Disclosure language={language} label={copy.pdfDetails}><Note language={language}>{web ? copy.browserPdf : copy.pdfShort}</Note><Note language={language}>{t.pdfNotice}</Note></Disclosure>
      {!memoriesUnavailable && !showUpdate &&
        <Disclosure language={language} label={t.createVersion} open={versionOpen} onChange={setVersionOpen}>{creation}</Disclosure>}
    </>}
    <ReadSection language={language} label={t.pdfVersions} loaded={exports !== null} busy={exportsLoading ?? busy}
      disabled={blocked || editor !== null} onLoad={onLoadExports}>
      {!exports?.length && <Note language={language}>{t.noExports}</Note>}
      {exports?.map(item => <View key={item.export_id} style={styles.source}>
        <Text accessibilityLanguage={accessibilityLanguages[storyLanguage]} allowFontScaling style={styles.heading}>{item.title}</Text>
        <Note language={language}>{t.version} {item.draft_version} · {t.revision} {item.draft_revision}</Note>
        <Button language={language} label={web ? copy.downloadSavedPdf : t.download} onPress={() => onDownloadExport(item)} disabled={blocked || editor !== null || !privacyReady || privacyFailed} />
      </View>)}
    </ReadSection>
  </View>;
}

const styles = StyleSheet.create({
  section: { width: '100%', gap: 16 },
  progress: { width: '100%', gap: 8, padding: 16, borderRadius: 16, backgroundColor: colors.selected },
  book: { width: '100%', gap: 24, padding: 20, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.paper },
  draftHeader: { gap: 4 },
  memory: { width: '100%', gap: 16, padding: 20, borderRadius: 24, borderWidth: 1, backgroundColor: colors.paper, borderColor: colors.border },
  reviewedMemory: { width: '100%', gap: 12, padding: 20, borderRadius: 24, backgroundColor: colors.selected },
  memoryActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  memoryAction: { flexGrow: 1, flexBasis: 80, maxWidth: '100%' },
  roomyAction: { flexBasis: 140 },
  changeAction: { minHeight: layout.minimumTouchTarget, minWidth: layout.minimumTouchTarget, flexGrow: 1, flexBasis: 80,
    maxWidth: '100%', flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, action: { flexGrow: 1, flexBasis: 140, maxWidth: '100%' },
  bookHeading: { color: colors.ink, fontFamily: headingFont, fontSize: 32, lineHeight: 42, flexShrink: 1 },
  heading: { color: colors.forest, fontSize: 22, lineHeight: 32, fontWeight: '600', flexShrink: 1 },
  body: { color: colors.ink, fontSize: 21, lineHeight: 33, flexShrink: 1 },
  note: { color: colors.muted, fontSize: 17, lineHeight: 27, flexShrink: 1 },
  status: { color: colors.forest, fontSize: 17, lineHeight: 26, fontWeight: '600', flexShrink: 1 },
  quote: { color: colors.muted, fontSize: 18, lineHeight: 29, borderLeftWidth: 2, borderColor: colors.border, paddingLeft: 12, flexShrink: 1 },
  source: { gap: 12, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border },
  prose: { color: colors.ink, fontFamily: headingFont, fontSize: 22, lineHeight: 36, flexShrink: 1 },
  input: { color: colors.ink, fontSize: 21, lineHeight: 33, minHeight: 80, textAlignVertical: 'top', padding: 14,
    borderRadius: 16, borderWidth: 1, borderColor: colors.forest, backgroundColor: colors.paper }, editor: { minHeight: 320 },
  disclosure: { minHeight: layout.minimumTouchTarget, width: '100%', paddingVertical: 10, paddingHorizontal: 2,
    flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: colors.border },
  disclosureLabel: { flex: 1, flexShrink: 1, color: colors.forest, fontSize: 21, lineHeight: 31, fontWeight: '600' },
  changeLabel: { textAlign: 'center' },
  marker: { color: colors.forest, fontSize: 24, lineHeight: 32 }, hidden: { display: 'none' },
  pressed: { backgroundColor: colors.selected }, focused: { borderColor: colors.ink, backgroundColor: colors.selected }, disabled: { opacity: 0.65 },
});
