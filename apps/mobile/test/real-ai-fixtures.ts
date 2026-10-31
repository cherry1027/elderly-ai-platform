import type { RealDraft, RealMemory, RealMessage, RealScope, RealTranscript } from '../src/real-ai/api';
export const realIds = {
  project: '10000000-0000-4000-8000-000000000001', session: '20000000-0000-4000-8000-000000000001',
  key: '30000000-0000-4000-8000-000000000001', transcript: '40000000-0000-4000-8000-000000000001',
  userMessage: '40000000-0000-4000-8000-000000000001', assistant: '50000000-0000-4000-8000-000000000002',
  memory: '60000000-0000-4000-8000-000000000001', draft: '70000000-0000-4000-8000-000000000001',
};
export const realDate = '2026-10-29T12:00:00Z';
export const realProvenance = { mode: 'real' as const, provider: 'openai' as const, model: 'synthetic-contract-model', version: 1 as const };
/** Synthetic contract fixtures only. No provider, account, phone or quality claim. */
export function realScope(): RealScope {
  return { baseUrl: 'http://192.168.20.40:8000', projectId: realIds.project, sessionId: realIds.session,
    language: 'en', getAccessToken: async () => 'synthetic.access-token.signature' };
}
export function realTranscript(overrides: Partial<RealTranscript> = {}): RealTranscript {
  return { transcript_id: realIds.transcript, project_id: realIds.project, session_id: realIds.session, language: 'en',
    text: 'Synthetic contract text, not a live transcription.', status: 'completed', created_at: realDate, provenance: realProvenance, ...overrides };
}
export function realMessage(role: 'user' | 'assistant' = 'user', overrides: Partial<RealMessage> = {}): RealMessage {
  return { id: role === 'user' ? realIds.userMessage : realIds.assistant, project_id: realIds.project, session_id: realIds.session,
    role, language: 'en', text: role === 'user' ? 'Synthetic contract user text.' : 'Synthetic contract interviewer question?',
    sequence: role === 'user' ? 1 : 2, source_transcript_id: realIds.transcript, created_at: realDate, provenance: realProvenance, ...overrides };
}
export function realMemory(overrides: Partial<RealMemory> = {}): RealMemory {
  return { id: realIds.memory, project_id: realIds.project, session_id: realIds.session, source_message_id: realIds.userMessage,
    fact_type: 'location', value: 'Synthetic location', evidence: 'Synthetic contract user text.', year: null, slot: null,
    uncertain: true, status: 'pending', corrected_value: null, version: 1, created_at: realDate, updated_at: realDate,
    clarification_question: 'Synthetic clarification?', ...overrides };
}
export function realDraft(overrides: Partial<RealDraft> = {}): RealDraft {
  return { draft_id: realIds.draft, project_id: realIds.project, status: 'needs_review', language: 'en', style: 'warm',
    version: 1, revision: 1, content: 'Synthetic draft for contract checks.', original_content: 'Synthetic draft for contract checks.', mode: 'real',
    source_memories: [{ memory_id: realIds.memory, memory_version: 2, source_message_id: realIds.userMessage,
      fact_type: 'location', value: 'Synthetic location', evidence: 'Synthetic contract user text.', corrected_value: null,
      year: null, slot: null, sentence: 'Synthetic location' }],
    verification: { status: 'needs_review', unsupported_claims: [], method: 'model_review_v1', checked_revision: 1,
      checked_at: realDate, sources_current: true, reason: null }, provenance: realProvenance,
    created_at: realDate, updated_at: realDate, ...overrides };
}
