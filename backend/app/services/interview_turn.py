"""Conservative conversation controls and evidence from the person's own words."""

from dataclasses import dataclass
import re

from app.services.conversation_provider import MAX_FACT_TEXT_LENGTH, FactCandidate
from app.services.openai_conversation import _complete_question, _last_sentence


_PAUSE = {
    "stop", "stop now", "please stop", "please stop now", "pause", "pause now",
    "let's stop", "let's stop here", "let's pause", "i want to stop", "i want to pause",
    "i'm done", "i am done", "i'm done for now", "that's enough", "that's all for now",
    "i don't want to tell more", "i don't want to tell any more", "i don't want to say more",
    "i don't want to say any more", "i do not want to tell more",
    "stopp", "paus", "stanna där", "vi stannar där", "vi kan stanna här", "vi kan pausa",
    "jag vill sluta", "jag vill pausa", "jag vill pausa nu", "jag är klar", "jag är klar nu",
    "jag vill inte berätta mer", "jag vill inte säga mer", "avsluta", "jag vill avsluta",
    "det räcker", "det räcker för idag", "det var allt", "det var allt för idag",
}
_CHANGE = {
    "move on", "let's move on", "can we move on", "i want to move on", "i'd like to move on",
    "change the subject", "let's change the subject", "can we change the subject",
    "i'm done with this topic", "i'm done with this subject", "let's talk about something else",
    "gå vidare", "vi går vidare", "kan vi gå vidare", "jag vill gå vidare",
    "jag är klar med det här ämnet", "byt ämne", "byta ämne", "jag vill byta ämne",
    "kan vi byta ämne", "kan vi prata om något annat", "vi pratar om något annat",
}
_AFFIRMATIVE = {
    "yes", "yes exactly", "yes that's right", "that's right", "correct", "exactly",
    "ja", "ja precis", "ja det stämmer", "det stämmer", "precis", "exakt",
}
_PAUSE_REPLY = {"en": "Of course. We can stop here.", "sv": "Självklart. Vi kan pausa här."}
_CHANGE_REPLY = {"en": "Of course. What other memory would you like to share?",
                 "sv": "Självklart. Vilket annat minne vill du berätta om?"}
_RESTATEMENT_REPLY = {
    "en": "Could you tell me that detail in your own words so I can capture it accurately?",
    "sv": "Kan du berätta den detaljen med egna ord så att jag får med den rätt?",
}
_PIVOT_REPLY = {
    "en": "Would you like to tell me more about this or move to another memory?",
    "sv": "Vill du berätta mer om det här eller gå vidare till ett annat minne?",
}
_FOLLOWUPS_BEFORE_PIVOT = 3
_INTRODUCTION = {
    "en": (re.compile(r"^((?:(?:hi|hello)[!,]?\s+)?(?:i am|i['’]m|my name is)\s+)minna\b", re.IGNORECASE),
           "Memy", "Hello, I’m Memy."),
    "sv": (re.compile(r"^((?:hej[!,]?\s+)?(?:jag är|jag heter|mitt namn är)\s+)memy\b", re.IGNORECASE),
           "Minna", "Hej, jag heter Minna."),
}

# A last-resort pending suggestion for one explicit first-person sentence.
# The optional affirmative prefix belongs to the evidence, never the memory.
_EXPLICIT_MEMORY = {
    "en": re.compile(
        r"(?:yes,?\s+)?(?P<memory>I\s+(?:grew up|lived|moved|was born|worked|studied|met)"
        r"\s+[^.!?;\r\n]{3,}\.?)(?<!\s)", re.IGNORECASE,
    ),
    "sv": re.compile(
        r"(?:ja,?\s+)?(?P<memory>Jag\s+(?:växte upp|bodde|flyttade|föddes|arbetade|jobbade|studerade|träffade)"
        r"\s+[^.!?;\r\n]{3,}\.?)(?<!\s)", re.IGNORECASE,
    ),
}
_QUALIFIED = re.compile(
    r"\b(?:not|never|maybe|perhaps|if|suppose|imagine|inte|aldrig|kanske|om|tänk)\b"
    r"|[\x00-\x1f\x7f\"“”«»]", re.IGNORECASE,
)


def _phrase(text: str) -> str:
    return " ".join(text.strip().casefold().replace("’", "'").replace(",", " ").rstrip(".!?…").split())


@dataclass(frozen=True)
class InterviewTurn:
    language: str
    reply: str | None
    memory_source: str
    recent_questions: tuple[str, ...] = ()

    def render_reply(self, reply: str, maximum: int) -> str:
        if self.reply is not None:
            return self.reply
        if _complete_question(reply) and _phrase(_last_sentence(reply)) in self.recent_questions:
            return _PIVOT_REPLY[self.language]
        introduction, name, short_intro = _INTRODUCTION[self.language]
        localized = introduction.sub(r"\g<1>" + name, reply, count=1)
        return localized if len(localized) <= maximum else short_intro


def plan_interview_turn(text: str, language: str, history: list[dict[str, str]]) -> InterviewTurn:
    source = text.strip()
    last = re.split(r"(?<=[.!?])\s+|\n+", source)[-1]
    phrase = _phrase(last)
    if phrase in _PAUSE or phrase in _CHANGE:
        reply = _PAUSE_REPLY if phrase in _PAUSE else _CHANGE_REPLY
        return InterviewTurn(language, reply[language], source[:-len(last)].rstrip())
    if _phrase(source) in _AFFIRMATIVE:
        after_question = bool(history and history[-1]["role"] == "assistant" and _complete_question(history[-1]["text"]))
        return InterviewTurn(language, _RESTATEMENT_REPLY[language] if after_question else None, "")

    recent = [row["text"] for row in history if row["role"] == "assistant"][-_FOLLOWUPS_BEFORE_PIVOT:]
    followups = tuple(_phrase(_last_sentence(reply)) for reply in recent if _complete_question(reply))
    previous_pivot = _phrase(_PIVOT_REPLY[language]) in followups
    if len(followups) == _FOLLOWUPS_BEFORE_PIVOT and not previous_pivot:
        return InterviewTurn(language, _PIVOT_REPLY[language], source)
    return InterviewTurn(language, None, source, followups)


def suggest_explicit_memory(source: str, language: str) -> FactCandidate | None:
    evidence = source.strip()
    if len(evidence) > MAX_FACT_TEXT_LENGTH or _QUALIFIED.search(evidence):
        return None
    match = _EXPLICIT_MEMORY[language].fullmatch(evidence)
    if match is None:
        return None
    return FactCandidate(fact_type="event", value=match.group("memory"), evidence=evidence)
