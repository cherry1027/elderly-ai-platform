"""Evaluate the actual real-v2 adapters with fictional EN/SV fixtures.

Offline manifest by default. Live mode needs upload consent, a valid private
approval, the same cumulative ledger/policy and all requested feature gates.
No Auth, database, hosted data or automatic retries are involved. Numeric results
are evidence of this sample only; language/factuality require human review.
"""

import argparse
import asyncio
from contextlib import ExitStack
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from uuid import UUID

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings
from app.core.errors import APIError
from app.services.ai_controls import ai_budget_subject
from app.services.audio_upload import MAX_AUDIO_BYTES, probe_duration
from app.services.real_ai_runtime import RealAIRuntime
from scripts.evaluate_ai import word_error_rate
from scripts.prepare_ai_evaluation import REFERENCES

EVALUATION_SUBJECT = UUID("ff8c7352-059d-4eb7-b50d-b62e971a8f52")
FACT_ID = "12000000-0000-4000-8000-000000000001"


def manifest():
    return {"version": 1, "mode": "offline", "paid_calls": 0,
        "quality_status": "NOT_RUN", "adapter_contract": "real-v2",
        "languages": ["en", "sv"], "fictional_only": True,
        "checks": ["transcription_names_places_dates", "original_wording",
            "memory_provenance", "date_contradiction", "project_language_on_code_switch",
            "confirmed_sources_story_writer_and_verifier", "optional_exact_spoken_reply"],
        "minimum_provider_attempts": 18,
        "optional_speech_attempts": 2,
        "required_manual_review": ["English and Swedish transcription accuracy",
            "natural interview question and correct reply language",
            "no invented life facts or chronology", "story usefulness and grounding",
            "spoken pronunciation if speech was requested"],
        "does_not_certify": ["older speakers, dialects or noisy recordings",
            "actual device acceptance", "hosted ownership isolation", "provider invoice"]}


def source_memory(language):
    sentence = "Jag växte upp i Malmö." if language == "sv" else "I grew up in Malmö."
    return {"memory_id": "13000000-0000-4000-8000-000000000001", "memory_version": 1,
        "source_message_id": "14000000-0000-4000-8000-000000000001",
        "fact_type": "location", "value": "Malmö", "evidence": sentence.rstrip("."),
        "corrected_value": None, "year": None, "slot": "grew_up_location", "sentence": sentence}


def score_transcription(reference, observed):
    # WER is deliberately strict: spoken-number and spelling equivalence still
    # need a human, and entity matches alone cannot establish overall accuracy.
    return {"word_error_rate": round(word_error_rate(reference, observed), 4),
        "fixture_entity_matches": {entity: entity.casefold() in observed.casefold()
            for entity in ("Ada", "Malmö", "1974")},
        "human_accuracy_review": "PENDING"}


async def evaluate(args, *, settings=None, runtime_factory=RealAIRuntime):
    if not args.live:
        return manifest()
    if not args.consent_to_provider_upload or args.audio_directory is None:
        raise APIError(422, "AI_EVALUATION_CONSENT_REQUIRED", "Explicit fixture-upload consent is required.")
    config = settings or Settings()
    if (not config.real_ai_enabled or config.real_ai_text_only
        or not config.real_ai_transcription_enabled or not config.real_ai_conversation_enabled
        or not config.real_ai_writing_enabled or (args.include_speech and not config.real_ai_speech_enabled)):
        raise APIError(503, "LIVE_AI_DISABLED", "The requested evaluation features are paused.")
    # Check all files before opening any provider path. Never follow fixture links.
    paths = {}
    for language in REFERENCES:
        path = args.audio_directory / f"fictional-{language}.wav"
        if path.is_symlink() or not path.is_file() or not 44 <= path.stat().st_size <= MAX_AUDIO_BYTES:
            raise APIError(422, "INVALID_RECORDING", "Both fictional fixture WAV files are required.")
        await probe_duration(path, ".wav")
        paths[language] = path
    runtime = runtime_factory(config)
    review_directory = getattr(args, "review_directory", None)
    if review_directory is not None:
        from scripts.staging_state import private_directory
        private_directory(review_directory)
        target = review_directory / "fictional-review-samples.json"
        if target.exists() or target.is_symlink():
            raise APIError(422, "AI_EVALUATION_REPORT_EXISTS", "Choose a new private evaluation output directory.")
    token = ai_budget_subject.set(str(EVALUATION_SUBJECT))
    results = []
    review_samples = []
    resources = ExitStack()
    try:
        workflow = getattr(runtime.governor, "workflow", None)
        if workflow is not None:
            resources.enter_context(workflow())
        provider = runtime.require()
        # Prevent spending the first half of a suite whose approved call count
        # cannot accommodate the minimum required stages. Budget is still
        # reserved atomically before every actual provider attempt.
        runtime.governor.check_budget(required_calls=20 if args.include_speech else 18)
        for language, reference in REFERENCES.items():
            row = {"language": language, "status": "INCOMPLETE", "completed_stages": []}
            results.append(row)
            sample = {"language": language, "fictional_fixture_reference": reference}
            review_samples.append(sample)
            try:
                transcript = await provider.transcribe(paths[language], language)
                sample["transcript"] = transcript
                row["transcription"] = score_transcription(reference, transcript)
                row["completed_stages"].append("transcription")
                turn = await provider.respond(transcript, language, [])
                sample["interviewer_reply"] = turn.text
                row["candidate_count"] = len(turn.facts)
                row["candidate_provenance_exact"] = all(
                    f.value in transcript and f.evidence in transcript for f in turn.facts)
                row["reply_nonempty"] = bool(turn.text.strip())
                row["at_most_one_question"] = turn.text.count("?") <= 1
                row["completed_stages"].append("interview_and_extraction")
                old = {"id": FACT_ID, "status": "confirmed", "fact_type": "event", "value": "1974",
                    "corrected_value": None, "year": 1974, "slot": "move"}
                correction = "Egentligen flyttade jag 1975." if language == "sv" else "Actually, I moved in 1975."
                changed = await provider.respond(correction, language, [old])
                sample["correction_reply"] = changed.text
                row["contradiction_flagged"] = any(f.uncertain and f.clarification_question
                    and f.conflicts_with_fact_id == FACT_ID for f in changed.facts)
                row["completed_stages"].append("contradiction")
                switched = await provider.respond(REFERENCES["en" if language == "sv" else "sv"], language, [])
                sample["code_switch_reply"] = switched.text
                row["code_switch_reply_nonempty"] = bool(switched.text.strip())
                row["actual_reply_language_review"] = "PENDING"
                row["completed_stages"].append("code_switch")
                story = await provider.write(language, "warm", [source_memory(language)])
                sample["story_confirmed_source"] = source_memory(language)["sentence"]
                sample["generated_story"] = story
                row["story_passed_model_verification"] = bool(story.strip())
                row["human_story_grounding_review"] = "PENDING"
                row["completed_stages"].append("story_and_verifier")
                if args.include_speech:
                    spoken = await provider.synthesize(turn.text, language)
                    row["speech"] = {"bytes": len(spoken.data), "duration_seconds": round(spoken.duration_seconds, 3),
                        "human_pronunciation_review": "PENDING"}
                    row["completed_stages"].append("speech")
                row["automated_checks_passed"] = all((row["candidate_count"] > 0,
                    row["candidate_provenance_exact"], row["reply_nonempty"], row["at_most_one_question"],
                    row["contradiction_flagged"], row["code_switch_reply_nonempty"],
                    row["story_passed_model_verification"]))
                row["status"] = "HUMAN_REVIEW_REQUIRED" if row["automated_checks_passed"] else "AUTOMATED_CHECKS_FAILED"
                if not row["automated_checks_passed"]:
                    break
            except APIError as error:
                # Keep a sanitized partial report, no transcript or provider body.
                row["error_code"] = error.code
                break  # No automatic retry or further spending after a failure.
        complete = len(results) == 2 and all(r["status"] == "HUMAN_REVIEW_REQUIRED" for r in results)
        return {**manifest(), "mode": "real", "paid_calls": "see_preserved_ledger",
            "timestamp": datetime.now(timezone.utc).isoformat(), "results": results,
            "quality_status": "HUMAN_REVIEW_REQUIRED" if complete else "INCOMPLETE",
            "synthetic_voice_limit": "Does not establish accuracy for older users or accents."}
    finally:
        resources.close()
        ai_budget_subject.reset(token)
        runtime.cache.close()
        if review_directory is not None:
            from scripts.staging_state import write_new
            # Deliberate synthetic fixture outputs for private language/factuality
            # review. Never log these samples or include them in public reports.
            write_new(review_directory / "fictional-review-samples.json",
                json.dumps({"fictional_only": True, "samples": review_samples}, ensure_ascii=False).encode()+b"\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--consent-to-provider-upload", action="store_true")
    parser.add_argument("--include-speech", action="store_true")
    parser.add_argument("--audio-directory", type=Path)
    parser.add_argument("--review-directory", type=Path,
        help="Optional existing private 0700 directory for synthetic review samples; never use real user recordings.")
    args = parser.parse_args(argv)
    try:
        report = asyncio.run(evaluate(args))
        print(json.dumps(report, ensure_ascii=False))
        return 2 if report["quality_status"] == "INCOMPLETE" else 0
    except APIError as error:
        print(json.dumps({"quality_status": "NOT_RUN", "error": {"code": error.code,
            "message": "Evaluation stopped before completion. Check the approved private configuration."}}))
        return 2
    except Exception:
        print('{"quality_status":"NOT_RUN","error":{"code":"AI_EVALUATION_FAILED","message":"Evaluation stopped safely."}}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
