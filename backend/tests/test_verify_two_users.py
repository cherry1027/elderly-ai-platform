import getpass
import io
import json
import os
import subprocess
import warnings
from types import SimpleNamespace
from uuid import UUID

import httpx
from pydantic import SecretStr

import scripts.verify_two_users as verifier
from scripts.verify_two_users import (
    BACKEND_DIR,
    DAY2_LIVE_TEST_NODE,
    DAY3_LIVE_TEST_FILE,
    DEV_SUPABASE_URL,
    LIVE_TEST_TIMEOUT_SECONDS,
    run_verification,
)

PUBLIC_KEY = "synthetic-public-key"
EMAIL_A = "test-a@example.invalid"
EMAIL_B = "test-b@example.invalid"
PASSWORD_A = "synthetic-password-a"
PASSWORD_B = "synthetic-password-b"
TOKEN_A = "synthetic-access-token-a"
TOKEN_B = "synthetic-access-token-b"
USER_A = UUID("11111111-1111-4111-8111-111111111111")
USER_B = UUID("22222222-2222-4222-8222-222222222222")


class TTYBuffer(io.StringIO):
    def isatty(self):
        return True


class NonTTYBuffer(io.StringIO):
    def isatty(self):
        return False


def configured_settings():
    return SimpleNamespace(
        supabase_configured=True,
        supabase_url=DEV_SUPABASE_URL,
        supabase_publishable_key=SecretStr(PUBLIC_KEY),
        request_timeout_seconds=5,
    )


def readers():
    emails = iter((EMAIL_A, EMAIL_B))
    passwords = iter((PASSWORD_A, PASSWORD_B))
    return lambda _prompt: next(emails), lambda _prompt, stream: next(passwords)


def auth_transport(*, same_user=False, auth_failure=False):
    credentials = {
        EMAIL_A: (PASSWORD_A, TOKEN_A, USER_A),
        EMAIL_B: (PASSWORD_B, TOKEN_B, USER_A if same_user else USER_B),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["apikey"] == PUBLIC_KEY
        if request.url.path == "/auth/v1/token":
            assert request.url.params["grant_type"] == "password"
            body = json.loads(request.content)
            password, token, _user_id = credentials[body["email"]]
            assert body["password"] == password
            if auth_failure:
                return httpx.Response(
                    400,
                    json={"message": f"do not print {password} or {token}"},
                )
            return httpx.Response(200, json={"access_token": token})
        if request.url.path == "/auth/v1/user":
            token = request.headers["authorization"].removeprefix("Bearer ")
            for _password, expected_token, user_id in credentials.values():
                if token == expected_token:
                    return httpx.Response(200, json={"id": str(user_id)})
        raise AssertionError(f"Unexpected request path: {request.url.path}")

    return httpx.MockTransport(handler)


def client_factory(transport):
    return lambda **kwargs: httpx.Client(transport=transport, **kwargs)


def test_cli_day3_flag_is_explicit_opt_in(monkeypatch):
    selections = []

    def fake_run_verification(*, include_day3=False):
        selections.append(include_day3)
        return 0

    monkeypatch.setattr(verifier, "run_verification", fake_run_verification)

    assert verifier.main([]) == 0
    assert verifier.main(["--day3"]) == 0
    assert selections == [False, True]


def test_refuses_non_tty_before_reading_credentials_or_connecting():
    called = []
    error_output = NonTTYBuffer()

    result = run_verification(
        stdin=NonTTYBuffer(),
        stdout=io.StringIO(),
        stderr=error_output,
        input_reader=lambda _prompt: called.append("input"),
        password_reader=lambda _prompt, stream: called.append("password"),
        settings_factory=lambda: called.append("settings"),
        client_factory=lambda **_kwargs: called.append("client"),
        process_runner=lambda *_args, **_kwargs: called.append("process"),
    )

    assert result == 2
    assert called == []
    assert "interactive local terminal" in error_output.getvalue()


def test_authenticates_existing_distinct_users_and_runs_only_live_test(monkeypatch):
    monkeypatch.delenv("MEMY_TEST_USER_A_TOKEN", raising=False)
    monkeypatch.delenv("MEMY_TEST_USER_B_TOKEN", raising=False)
    monkeypatch.setenv("RUN_MEMY_DAY3_INTEGRATION", "1")
    input_reader, password_reader = readers()
    standard_output = TTYBuffer()
    error_output = TTYBuffer()
    calls = []

    def process_runner(command, **kwargs):
        calls.append((command, kwargs))
        environment = kwargs["env"]
        assert environment["RUN_MEMY_DAY2_INTEGRATION"] == "1"
        assert environment["MEMY_TEST_USER_A_TOKEN"] == TOKEN_A
        assert environment["MEMY_TEST_USER_B_TOKEN"] == TOKEN_B
        assert environment["PYTHONDONTWRITEBYTECODE"] == "1"
        assert "RUN_MEMY_DAY3_INTEGRATION" not in environment
        assert TOKEN_A not in command and TOKEN_B not in command
        return subprocess.CompletedProcess(command, 0, "1 passed\n", "")

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=standard_output,
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport()),
        process_runner=process_runner,
    )

    assert result == 0
    assert len(calls) == 1
    command, kwargs = calls[0]
    assert command == [
        os.sys.executable,
        "-m",
        "pytest",
        "-q",
        "-p",
        "no:cacheprovider",
        DAY2_LIVE_TEST_NODE,
    ]
    assert kwargs["cwd"] == BACKEND_DIR
    assert kwargs["capture_output"] is True
    assert kwargs["text"] is True
    assert kwargs["check"] is False
    assert kwargs["timeout"] == LIVE_TEST_TIMEOUT_SECONDS
    assert "1 passed" in standard_output.getvalue()
    assert "verification passed" in standard_output.getvalue()
    assert error_output.getvalue() == ""
    assert "MEMY_TEST_USER_A_TOKEN" not in os.environ
    assert "MEMY_TEST_USER_B_TOKEN" not in os.environ


def test_day3_opt_in_runs_day2_and_day3_live_tests():
    input_reader, password_reader = readers()
    captured = {}

    def process_runner(command, **kwargs):
        captured["command"] = command
        environment = kwargs["env"]
        assert environment["RUN_MEMY_DAY2_INTEGRATION"] == "1"
        assert environment["RUN_MEMY_DAY3_INTEGRATION"] == "1"
        assert environment["MEMY_TEST_USER_A_TOKEN"] == TOKEN_A
        assert environment["MEMY_TEST_USER_B_TOKEN"] == TOKEN_B
        return subprocess.CompletedProcess(command, 0, "2 passed\n", "")

    result = run_verification(
        include_day3=True,
        stdin=TTYBuffer(),
        stdout=TTYBuffer(),
        stderr=TTYBuffer(),
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport()),
        process_runner=process_runner,
    )

    assert result == 0
    assert captured["command"][-2:] == [DAY2_LIVE_TEST_NODE, DAY3_LIVE_TEST_FILE]


def test_getpass_fallback_warning_is_rejected_without_running_tests():
    emails = iter((EMAIL_A, EMAIL_B))
    standard_output = TTYBuffer()
    error_output = TTYBuffer()

    def insecure_password_reader(_prompt, stream):
        warnings.warn("terminal echo fallback", getpass.GetPassWarning)
        return PASSWORD_A

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=standard_output,
        stderr=error_output,
        input_reader=lambda _prompt: next(emails),
        password_reader=insecure_password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(
            httpx.MockTransport(
                lambda _request: (_ for _ in ()).throw(
                    AssertionError("network must not be used")
                )
            )
        ),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
    )

    combined_output = standard_output.getvalue() + error_output.getvalue()
    assert result == 2
    assert "Secure password input is unavailable" in combined_output
    assert "terminal echo fallback" not in combined_output
    assert PASSWORD_A not in combined_output


def test_rejects_same_email_before_password_prompt_or_network():
    prompts = iter((EMAIL_A, EMAIL_A.upper()))
    called = []
    error_output = TTYBuffer()

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=TTYBuffer(),
        stderr=error_output,
        input_reader=lambda _prompt: next(prompts),
        password_reader=lambda _prompt, stream: called.append("password"),
        settings_factory=configured_settings,
        client_factory=lambda **_kwargs: called.append("client"),
        process_runner=lambda *_args, **_kwargs: called.append("process"),
    )

    assert result == 2
    assert called == []
    assert "two different" in error_output.getvalue()


def test_auth_failure_does_not_print_upstream_body_or_credentials():
    input_reader, password_reader = readers()
    standard_output = TTYBuffer()
    error_output = TTYBuffer()

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=standard_output,
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport(auth_failure=True)),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
    )

    combined_output = standard_output.getvalue() + error_output.getvalue()
    assert result == 2
    assert "sign-in failed" in combined_output
    for sensitive in (EMAIL_A, PASSWORD_A, TOKEN_A, PUBLIC_KEY):
        assert sensitive not in combined_output


def test_rejects_two_tokens_that_resolve_to_the_same_user():
    input_reader, password_reader = readers()
    error_output = TTYBuffer()

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=TTYBuffer(),
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport(same_user=True)),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
    )

    assert result == 2
    assert "two different" in error_output.getvalue()


def test_redacts_child_output_and_preserves_failed_exit_code():
    input_reader, password_reader = readers()
    standard_output = TTYBuffer()
    error_output = TTYBuffer()
    jwt_shaped_value = "eyJabcdefgh.ijklmnop.qrstuvwx"

    def process_runner(command, **_kwargs):
        return subprocess.CompletedProcess(
            command,
            1,
            f"leak={TOKEN_A} password={PASSWORD_A} email={EMAIL_A} jwt={jwt_shaped_value}\n",
            f"key={PUBLIC_KEY} other={TOKEN_B} password={PASSWORD_B}\n",
        )

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=standard_output,
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport()),
        process_runner=process_runner,
    )

    combined_output = standard_output.getvalue() + error_output.getvalue()
    assert result == 1
    assert "[REDACTED]" in combined_output
    for sensitive in (
        TOKEN_A,
        TOKEN_B,
        PASSWORD_A,
        PASSWORD_B,
        EMAIL_A,
        EMAIL_B,
        PUBLIC_KEY,
        jwt_shaped_value,
    ):
        assert sensitive not in combined_output
    assert "verification failed" in combined_output


def test_subprocess_timeout_is_controlled_and_partial_output_is_redacted():
    input_reader, password_reader = readers()
    standard_output = TTYBuffer()
    error_output = TTYBuffer()

    def process_runner(command, **kwargs):
        raise subprocess.TimeoutExpired(
            command,
            kwargs["timeout"],
            output=f"token={TOKEN_A} password={PASSWORD_A}\n",
            stderr=f"key={PUBLIC_KEY} email={EMAIL_B}\n",
        )

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=standard_output,
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport()),
        process_runner=process_runner,
        process_timeout_seconds=7,
    )

    combined_output = standard_output.getvalue() + error_output.getvalue()
    assert result == 124
    assert "timed out and was stopped" in combined_output
    assert "[REDACTED]" in combined_output
    for sensitive in (TOKEN_A, PASSWORD_A, PUBLIC_KEY, EMAIL_B):
        assert sensitive not in combined_output


def test_keyboard_interrupt_during_pytest_is_controlled():
    input_reader, password_reader = readers()
    error_output = TTYBuffer()

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=TTYBuffer(),
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=client_factory(auth_transport()),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            KeyboardInterrupt()
        ),
    )

    assert result == 130
    assert error_output.getvalue() == "Verification cancelled.\n"


def test_unexpected_dependency_exception_is_sanitized():
    input_reader, password_reader = readers()
    standard_output = TTYBuffer()
    error_output = TTYBuffer()

    class BrokenClientContext:
        def __enter__(self):
            raise RuntimeError(f"do not expose {PUBLIC_KEY} {TOKEN_A}")

        def __exit__(self, *_args):
            return False

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=standard_output,
        stderr=error_output,
        input_reader=input_reader,
        password_reader=password_reader,
        settings_factory=configured_settings,
        client_factory=lambda **_kwargs: BrokenClientContext(),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
    )

    combined_output = standard_output.getvalue() + error_output.getvalue()
    assert result == 2
    assert "Unable to authenticate" in combined_output
    assert PUBLIC_KEY not in combined_output
    assert TOKEN_A not in combined_output


def test_refuses_wrong_project_before_prompting_for_credentials():
    settings = configured_settings()
    settings.supabase_url = "https://example.invalid"
    called = []
    error_output = TTYBuffer()

    result = run_verification(
        stdin=TTYBuffer(),
        stdout=TTYBuffer(),
        stderr=error_output,
        input_reader=lambda _prompt: called.append("input"),
        password_reader=lambda _prompt, stream: called.append("password"),
        settings_factory=lambda: settings,
        client_factory=lambda **_kwargs: called.append("client"),
        process_runner=lambda *_args, **_kwargs: called.append("process"),
    )

    assert result == 2
    assert called == []
    assert "dedicated Memy AI development project" in error_output.getvalue()
