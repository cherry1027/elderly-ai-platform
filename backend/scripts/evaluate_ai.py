"""Offline by default; approved live bilingual adapter evaluation, never DB writes."""

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings
from app.core.errors import APIError
from app.services.ai_providers import evaluation_providers
from app.services.audio_upload import probe_duration
from scripts.prepare_ai_evaluation import REFERENCES


def words(text):
    return re.findall(r"\w+", text.casefold())


def word_error_rate(reference, actual):
    expected, observed = words(reference), words(actual)
    if not expected:
        raise ValueError("Reference cannot be empty")
    row = list(range(len(observed) + 1))
    for i, word in enumerate(expected, 1):
        next_row = [i]
        for j, actual_word in enumerate(observed, 1):
            next_row.append(min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (word != actual_word)))
        row = next_row
    return row[-1] / len(expected)


async def evaluate(args):
    if not args.live:
        return {"mode": "offline", "paid_calls": 0, "quality_status": "NOT_RUN",
                "languages": ["en", "sv"], "cases": ["speech_names_dates", "date_contradiction",
                    "source_grounding", "language_switch", "unsupported_story_claim", "usage_limit"],
                "recordings": "Provide the prepared fictional WAV directory for approved live evaluation."}
    if not args.consent_to_provider_upload or args.audio_directory is None:
        raise APIError(422, "AI_EVALUATION_CONSENT_REQUIRED", "Explicit fictional-recording upload consent is required.")
    settings = Settings()
    if settings.ai_provider_mode != "openai":
        raise APIError(503, "AI_SPENDING_NOT_APPROVED", "Live evaluation is not enabled.")
    providers = evaluation_providers(settings)
    # Validate BOTH recordings before the first potentially paid request.
    paths = {language: args.audio_directory / f"fictional-{language}.wav" for language in REFERENCES}
    for path in paths.values():
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 25_000_000:
            raise APIError(422, "INVALID_RECORDING", "Prepared fictional recordings are required.")
        await probe_duration(path, ".wav")
    results = []
    for language, reference in REFERENCES.items():
        transcript = await providers.transcription.transcribe(paths[language], language)
        turn = await providers.conversation.respond(transcript, language, [])
        # Explicitly fictional evaluation facts, not auto-confirmed extraction or
        # real user data. Nothing here is inserted into Supabase.
        old_move = {"id": "12000000-0000-4000-8000-000000000001", "fact_type": "event",
                    "value": "1974", "year": 1974, "slot": "move", "status": "confirmed",
                    "corrected_value": None}
        correction = "Egentligen flyttade jag 1975." if language == "sv" else "Actually, I moved in 1975."
        conflicting = await providers.conversation.respond(correction, language, [old_move])
        switched = await providers.conversation.respond(
            REFERENCES["en" if language == "sv" else "sv"], language, [])
        sentence = "Jag växte upp i Malmö." if language == "sv" else "I grew up in Malmö."
        source = {"memory_id": "13000000-0000-4000-8000-000000000001", "memory_version": 2,
                  "source_message_id": "14000000-0000-4000-8000-000000000001", "fact_type": "location",
                  "value": "Malmö", "evidence": sentence.rstrip("."), "corrected_value": None,
                  "year": None, "slot": "grew_up_location", "sentence": sentence}
        story = await providers.story.write(language, "warm", [source])
        unsupported = sentence + ("\n\nJag vann ett internationellt pris." if language == "sv"
                                   else "\n\nI won an international award.")
        rejected_unsupported = False
        try:
            await providers.story.verify_candidate(unsupported, language, [source])
        except APIError as error:
            if error.code != "DRAFT_VERIFICATION_FAILED":
                raise
            rejected_unsupported = True
        # Summaries only: never print/save transcripts, model replies or biographies.
        results.append({"language": language, "word_error_rate": round(word_error_rate(reference, transcript), 4),
                        "candidate_count": len(turn.facts), "clarification_count": sum(
                            fact.clarification_question is not None for fact in turn.facts),
                        "named_entity_checks": {entity: entity.casefold() in transcript.casefold()
                                                for entity in ("Ada", "Malmö", "1974")},
                        "contradiction_flagged": any(fact.uncertain and fact.clarification_question
                            and fact.conflicts_with_fact_id == old_move["id"] for fact in conflicting.facts),
                        "code_switch_reply_nonempty": bool(switched.text),
                        "story_passed_model_review": bool(story),
                        "unsupported_story_rejected": rejected_unsupported,
                        "human_accuracy_and_language_review": "REQUIRED"})
    return {"mode": "openai", "timestamp": datetime.now(timezone.utc).isoformat(), "results": results,
            "quality_status": "HUMAN_REVIEW_REQUIRED",
            "budget": "Reserved per HTTP attempt; reconcile actual provider usage separately."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--consent-to-provider-upload", action="store_true")
    parser.add_argument("--audio-directory", type=Path)
    args = parser.parse_args(argv)
    try:
        result = asyncio.run(evaluate(args))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except APIError as error:
        print(json.dumps({"error": {"code": error.code, "message": error.message}}))
        return 2
    except Exception:
        print('{"error":{"code":"AI_EVALUATION_FAILED","message":"Evaluation stopped safely; inspect approved local configuration."}}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
