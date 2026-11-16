"""Minna's speaking style for preview speech and Live Talk."""

CEDAR_VOICE = "cedar"
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
