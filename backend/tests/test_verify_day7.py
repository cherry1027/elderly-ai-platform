"""Safety and orchestration checks for the explicitly opt-in hosted harness."""

import asyncio
import getpass
import io
import json
import warnings

import httpx
import pytest

from app.core.config import Settings
from app.services.conversation_provider import DisabledConversationProvider, MockConversationProvider
from scripts import verify_day7 as verifier


KEY = "synthetic-public-key"
TOKEN_A, TOKEN_B = "synthetic-user-a-token", "synthetic-user-b-token"
USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
PROJECT = "33333333-3333-4333-8333-333333333333"
ENV = {"MEMY_DAY7_USER_A_TOKEN": TOKEN_A, "MEMY_DAY7_USER_B_TOKEN": TOKEN_B}


class TTY(io.StringIO):
    def isatty(self):
        return True


def settings(url=verifier.DEV_SUPABASE_URL):
    return Settings(_env_file=None, supabase_url=url, supabase_publishable_key=KEY)


def upstream_factory(*, same_user=False, fail=False, requests=None):
    def handle(request):
        if requests is not None:
            requests.append(request)
        assert request.url.host == "edbkuunyeyxnyenmmqud.supabase.co"
        assert request.headers["apikey"] == KEY
        if request.method == "POST" and request.url.path == "/auth/v1/token":
            email = json.loads(request.content)["email"]
            return httpx.Response(200, json={"access_token": TOKEN_A if email.startswith("a") else TOKEN_B})
        if request.url.path == "/auth/v1/user":
            if fail:
                return httpx.Response(401, json={"private": TOKEN_A})
            user = USER_A if same_user or request.headers["authorization"].endswith(TOKEN_A) else USER_B
            return httpx.Response(200, json={"id": user})
        if request.method == "DELETE":
            assert request.url.path == "/rest/v1/story_projects"
            assert request.url.params["id"] == f"eq.{PROJECT}"
            assert request.headers["authorization"] == f"Bearer {TOKEN_A}"
            return httpx.Response(204)
        if request.method == "GET" and request.url.path == "/rest/v1/story_projects":
            assert request.url.params["id"] == f"eq.{PROJECT}"
            assert request.url.params["select"] == "id"
            return httpx.Response(200, json=[])
        raise AssertionError("Unexpected upstream operation")

    return lambda **kwargs: httpx.Client(transport=httpx.MockTransport(handle), **kwargs)


class LocalProbeClient:
    def __init__(self, app):
        self.app = app

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def get(self, path):
        assert path in ("/health", "/ready")
        return httpx.Response(200, json={"status": "ok"})


def run(**overrides):
    output, error = io.StringIO(), TTY()
    options = {
        "run": True, "tokens_from_env": True, "environ": ENV,
        "stdout": output, "stderr": error,
        "settings_factory": settings, "client_factory": upstream_factory(),
        "test_client_factory": LocalProbeClient,
        "journey_runner": lambda *_args: None,
    }
    options.update(overrides)
    result = verifier.run_verification(**options)
    return result, output.getvalue(), error.getvalue()


def test_requires_explicit_opt_in_before_reading_settings_or_credentials():
    called = []
    result, output, error = run(run=False, settings_factory=lambda: called.append("settings"))
    assert result == 2 and not called and not output
    assert "No changes made" in error


def test_no_echo_fallback_or_piped_password_input():
    result, _, error = run(tokens_from_env=False, stdin=io.StringIO(),
                           settings_factory=lambda: pytest.fail("Must refuse before settings"))
    assert result == 2 and "real terminal" in error


@pytest.mark.parametrize("url", ["https://old.supabase.co", "http://localhost:54321"])
def test_other_supabase_targets_refused_before_connecting(url):
    result, _, error = run(settings_factory=lambda: settings(url),
                           client_factory=lambda **_kwargs: pytest.fail("No connection allowed"))
    assert result == 1 and "only the dedicated" in error


def test_missing_configuration_refused():
    result, _, error = run(settings_factory=lambda: Settings(_env_file=None),
                           client_factory=lambda **_kwargs: pytest.fail("No connection allowed"))
    assert result == 1 and "incomplete" in error


def test_mock_factory_sets_all_three_free_providers():
    app, provider = verifier.build_mock_app(settings())
    assert app.state.settings.conversation_mode == "mock"
    assert app.state.settings.story_generation_mode == "mock"
    assert type(app.state.conversation_provider) is MockConversationProvider
    assert provider is app.state.transcription_provider
    assert type(provider) is verifier.FictionalTranscriptionProvider


def test_mutation_boundary_rejects_changed_provider_even_if_factory_claims_safe():
    def bad_factory(config):
        app, provider = verifier.build_mock_app(config)
        app.state.conversation_provider = DisabledConversationProvider()
        return app, provider

    result, _, error = run(app_factory=bad_factory,
                           client_factory=lambda **_kwargs: pytest.fail("No connection allowed"))
    assert result == 1 and "explicit free mock providers" in error


def test_two_distinct_accounts_required_before_any_journey():
    result, _, error = run(client_factory=upstream_factory(same_user=True),
                           journey_runner=lambda *_args: pytest.fail("No writes allowed"))
    assert result == 1 and "two different" in error


def test_invalid_or_missing_token_fails_without_printing_body_or_secrets():
    for env in ({}, ENV):
        result, output, error = run(environ=env, client_factory=upstream_factory(fail=True))
        assert result == 1
        assert TOKEN_A not in output + error
        assert TOKEN_B not in output + error
        assert KEY not in output + error


def test_both_languages_alternate_owners_and_are_explicitly_mock_only():
    seen = []

    def journey(client, first, second, language, created, run_id, provider):
        seen.append((first, second, language))
        assert run_id and type(provider) is verifier.FictionalTranscriptionProvider
        created.append((PROJECT, first))

    requests = []
    result, output, error = run(journey_runner=journey,
                               client_factory=upstream_factory(requests=requests))
    assert result == 0 and not error
    assert seen == [(TOKEN_A, TOKEN_B, "sv"), (TOKEN_B, TOKEN_A, "en")]
    assert all(request.method != "DELETE" for request in requests)
    assert "Retained synthetic project" in output
    assert "real AI, mobile, email and deployed-server acceptance remain separate" in output
    assert TOKEN_A not in output and TOKEN_B not in output


def test_cleanup_is_explicit_and_uses_only_current_run_ids_with_owner_token():
    requests = []

    def journey(_client, first, _other, _language, created, _run_id, _provider):
        created.append((PROJECT, first))

    result, output, error = run(cleanup=True, languages=("sv",), journey_runner=journey,
                               client_factory=upstream_factory(requests=requests))
    assert result == 0 and not error
    assert [request.method for request in requests] == ["GET", "GET", "DELETE", "GET"]
    assert "Retained synthetic project" not in output
    assert "Auth users were not deleted" in output


def test_interrupted_or_failed_journey_still_cleans_only_its_current_projects():
    requests = []

    def journey(_client, first, _other, _language, created, _run_id, _provider):
        created.append((PROJECT, first))
        raise RuntimeError(f"must not leak {TOKEN_A}")

    result, output, error = run(cleanup=True, languages=("sv",), journey_runner=journey,
                               client_factory=upstream_factory(requests=requests))
    assert result == 1 and TOKEN_A not in output + error
    assert requests[-2].method == "DELETE"
    assert "credential details suppressed" in error


def test_unconfirmed_deletion_is_reported_and_does_not_claim_cleanup():
    def journey(_client, first, _other, _language, created, _run_id, _provider):
        created.append((PROJECT, first))

    factory = upstream_factory()

    def cleanup_failure_factory(**kwargs):
        client = factory(**kwargs)
        original_delete = client.delete

        def denied_delete(*args, **options):
            original_delete(*args, **options)  # Verify the scoped target and owner headers.
            return httpx.Response(403)

        client.delete = denied_delete
        return client

    result, output, error = run(cleanup=True, languages=("sv",), journey_runner=journey,
                               client_factory=cleanup_failure_factory)
    assert result == 1
    assert "cleanup incomplete" in error
    assert PROJECT in output
    assert "Deleted only" not in output
    assert "PASS hosted" not in output


def test_hidden_login_rejects_getpass_warning_without_fallback():
    def insecure_reader(*_args, **_kwargs):
        warnings.warn("echo", getpass.GetPassWarning)
        return "must not be accepted"

    result, _, error = run(tokens_from_env=False, stdin=TTY(), secret_reader=insecure_reader)
    assert result == 2 and "hidden input unavailable" in error


def test_hidden_password_login_keeps_credentials_out_of_output():
    values = iter(("a@example.invalid", "synthetic-private-password-a",
                   "b@example.invalid", "synthetic-private-password-b"))
    result, output, error = run(tokens_from_env=False, stdin=TTY(),
                               secret_reader=lambda *_args, **_kwargs: next(values))
    assert result == 0 and not error
    for secret in ("a@example.invalid", "b@example.invalid", "synthetic-private-password-a", TOKEN_A, TOKEN_B):
        assert secret not in output


def test_only_declared_fixture_languages_are_allowed():
    result, _, error = run(languages=("fr",), settings_factory=lambda: pytest.fail("No settings read"))
    assert result == 2 and "Only en and sv" in error


@pytest.mark.parametrize("language", ["en", "sv"])
def test_fictional_audio_text_is_understood_as_one_uncertain_location(language):
    result = asyncio.run(MockConversationProvider().respond(
        verifier.FictionalTranscriptionProvider.texts[language], language, [],
    ))
    assert len(result.facts) == 1
    assert result.facts[0].value == "Malmö"
    assert result.facts[0].uncertain is True
    assert result.facts[0].clarification_question


def test_cli_maps_explicit_flags_without_reading_shell_credentials(monkeypatch):
    options = []
    monkeypatch.setattr(verifier, "run_verification", lambda **kwargs: options.append(kwargs) or 0)
    assert verifier.main(["--run", "--tokens-from-env", "--cleanup", "--language", "sv"]) == 0
    assert options == [{"run": True, "tokens_from_env": True, "cleanup": True, "languages": ("sv",)}]


def test_identical_manual_edit_retry_is_idempotent_before_rejecting_different_stale_content():
    calls = []
    edited = {"revision": 2, "content": "Manual synthetic content", "original_content": "Original"}
    edit = {"content": edited["content"], "expected_revision": 1}

    class EditClient:
        def patch(self, path, *, headers, json):
            assert path == "/api/v1/story-drafts/synthetic-id"
            assert headers == {"Authorization": f"Bearer {TOKEN_A}"}
            calls.append(json)
            if json["content"] == edited["content"]:
                return httpx.Response(200, json=edited)
            assert json["expected_revision"] == 1
            return httpx.Response(409, json={"error": {"code": "REVISION_CONFLICT"}})

    verifier.verify_edit_retries(EditClient(), "/api/v1/story-drafts/synthetic-id",
                                  verifier.auth_headers(TOKEN_A), edit, edited)
    assert calls[0] == edit
    assert calls[1]["expected_revision"] == 1
    assert calls[1]["content"] != edited["content"]
