"""Minna's voices and delivery instructions."""

CEDAR_VOICE = "cedar"
LIVE_FALLBACK_VOICE = "coral"
LIVE_VOICE_DESCRIPTION = (
    "The warm, clearly feminine voice of an adult Swedish woman in her 50s. "
    "Native standard Swedish as spoken in Sweden, with natural vowel lengths, pitch accents and sentence melody. "
    "Use a clear mid pitch with gentle resonance and a calm, attentive tone. "
    "When speaking English, keep the same vocal identity and a light, natural Swedish accent. "
    "Speak conversationally, with clear words and room to think."
)
_DELIVERY = (
    "Speak in the voice of a warm Swedish woman in her 50s or 60s. "
    "Keep a softly feminine resonance, a comfortable mid pitch and gentle expression "
    "from the first word to the last. Speak at a relaxed conversational pace, as if "
    "sitting with someone you know. Avoid a deep, boomy delivery or an announcer tone."
)
MINNA_DELIVERY = {
    "sv": _DELIVERY + " Use natural Swedish as spoken in Sweden, with ordinary vowel length, "
                     "word stress and sentence melody.",
    "en": _DELIVERY + " Speak clearly in English with a light, natural Swedish accent. "
                     "Keep the English wording and the same feminine voice throughout.",
}
