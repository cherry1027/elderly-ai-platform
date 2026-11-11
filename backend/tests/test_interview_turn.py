"""Both real interviewer paths use the same controls and keep exact user evidence."""

import asyncio

import pytest

from tests.test_real_ai_provider import ScriptedClient, extracted, fact, provider


def respond(language, source, reply, *, history=(), facts=(), prior=(), combined):
    extraction = {"language": language, "facts": list(facts)}
    raw_reply = {"language": language, "text": reply}
    responses = [{"extraction": extraction, "reply": raw_reply}] if combined else [extraction, raw_reply]
    client = ScriptedClient(responses)
    result = asyncio.run(provider(client, combined_turn=combined).respond(source, language, list(prior), list(history)))
    assert [call["operation"] for call in client.calls] == (["conversation"] if combined else ["memory_extraction", "conversation"])
    return result, client


@pytest.mark.parametrize("combined", [False, True])
@pytest.mark.parametrize("language,source,reply,expected", [
    ("en", "I’m done.", "What happened next?", "Of course. We can stop here."),
    ("en", "I don’t want to tell more.", "What happened next?", "Of course. We can stop here."),
    ("en", "I don't want to tell any more.", "What happened next?", "Of course. We can stop here."),
    ("en", "I don’t want to say more.", "What happened next?", "Of course. We can stop here."),
    ("sv", "Det räcker för idag.", "Vad hände sedan?", "Självklart. Vi kan pausa här."),
    ("sv", "Jag vill inte berätta mer.", "Vad hände sedan?", "Självklart. Vi kan pausa här."),
    ("sv", "Avsluta.", "Vad hände sedan?", "Självklart. Vi kan pausa här."),
    ("en", "Can we move on?", "What else happened that day?", "Of course. What other memory would you like to share?"),
    ("sv", "Kan vi prata om något annat?", "Vad hände just då?", "Självklart. Vilket annat minne vill du berätta om?"),
])
def test_explicit_pause_or_pivot_overrides_the_model_and_saves_no_control_as_memory(combined, language, source, reply, expected):
    facts = extracted(language, value=source, evidence=source)["facts"]
    result, _ = respond(language, source, reply, facts=facts, combined=combined)
    assert result.text == expected and result.facts == []


def test_pause_suffix_excludes_control_candidate_without_losing_the_preceding_memory():
    detail = "Jag arbetade i Malmö."
    pause = "Jag vill inte berätta mer."
    false_fact = extracted("sv", value=pause, evidence=pause)["facts"]
    result, _ = respond("sv", f"{detail} {pause}", "Vad hände sedan?", facts=false_fact, combined=True)
    assert result.text == "Självklart. Vi kan pausa här."
    assert [(item.value, item.evidence) for item in result.facts] == [(detail, detail)]


@pytest.mark.parametrize("combined", [False, True])
@pytest.mark.parametrize("language,source,question,reply,fragment", [
    ("en", "Yes, exactly.", "Was your first job in Malmö?", "What did you like about that job?", "in your own words"),
    ("sv", "Ja, det stämmer.", "Bodde du i Malmö 1975?", "Hur var det att bo där?", "med egna ord"),
])
def test_bare_affirmation_needs_own_words_and_keeps_out_question_details(combined, language, source, question, reply, fragment):
    facts = extracted(language, value=source, evidence=source)["facts"]
    result, client = respond(language, source, reply, history=[{"role": "assistant", "text": question}], facts=facts,
                             combined=combined)
    assert fragment in result.text and "Malmö" not in result.text and result.facts == []
    assert "Never fill in words from an interviewer's question" in client.calls[0]["instructions"]


@pytest.mark.parametrize("combined", [False, True])
@pytest.mark.parametrize("language,source,value,reply", [
    ("en", "  Yes, I lived in Malmö in 1975.  ", "I lived in Malmö in 1975.", "What stands out about that time?"),
    ("sv", "Ja, jag arbetade på biblioteket i Lund.", "jag arbetade på biblioteket i Lund.", "Vad minns du bäst från det arbetet?"),
])
def test_explicit_restatement_remains_a_pending_exact_source_if_model_misses_it(combined, language, source, value, reply):
    history = [{"role": "assistant", "text": "Was that the year you were in Göteborg?"}]
    result, _ = respond(language, source, reply, history=history, combined=combined)
    assert result.text == reply and len(result.facts) == 1
    memory = result.facts[0]
    assert memory.value == value and memory.evidence == source.strip()
    assert "Göteborg" not in memory.evidence and memory.year is None and memory.slot is None
    assert memory.conflicts_with_fact_id is None
    duplicate, _ = respond(language, source, reply, prior=[fact(value=value.rstrip("."), fact_type="event", slot=None)],
                           combined=combined)
    assert duplicate.facts == []


@pytest.mark.parametrize("source", ["Jag bodde kanske i Malmö.", "Jag arbetade inte i Malmö.",
                                    "Jag arbetade på biblioteket?", 'Jag arbetade på "Biblioteket".',
                                    "Om jag arbetade där, är det glömt.", "Jag arbetade. Jag studerade också."])
def test_no_local_inference_from_uncertain_or_nonstandalone_sources(source):
    result, _ = respond("sv", source, "Vad minns du om den tiden?", combined=True)
    assert result.facts == []


@pytest.mark.parametrize("combined", [False, True])
def test_pivot_offer_after_three_questions_and_does_not_repeat_the_offer_on_next_turn(combined):
    history = [{"role": "assistant", "text": question} for question in (
        "Vad minns du från skolan?", "Vilka träffade du där?", "Vad brukade ni göra på rasterna?",
    )]
    result, _ = respond("sv", "Jag bodde i Lund.", "Vad hände på nästa rast?", history=history, combined=combined)
    assert result.text == "Vill du berätta mer om det här eller gå vidare till ett annat minne?"
    assert result.facts[0].value == "Jag bodde i Lund."

    next_reply = "Vad minns du från ditt första arbete?"
    history.append({"role": "assistant", "text": result.text})
    following, _ = respond("sv", "Jag började arbeta på ett bibliotek.", next_reply, history=history, combined=combined)
    assert following.text == next_reply


@pytest.mark.parametrize("language,source,reply,expected", [
    ("sv", "Hej.", "Hej, jag heter Memy.", "Hej, jag heter Minna."),
    ("en", "Hi.", "Hello! I’m Minna.", "Hello! I’m Memy."),
    ("sv", "Jag heter Memy.", "Du berättade: jag heter Memy.", "Du berättade: jag heter Memy."),
])
def test_first_person_interviewer_introduction_matches_project_language(language, source, reply, expected):
    result, _ = respond(language, source, reply, combined=True)
    assert result.text == expected


def test_localized_name_does_not_expand_the_reply_past_the_speech_limit():
    start = "Hej, jag heter Memy. "
    reply = start + "x" * (1000 - len(start))
    result, _ = respond("sv", "Hej.", reply, combined=True)
    assert result.text == "Hej, jag heter Minna."
