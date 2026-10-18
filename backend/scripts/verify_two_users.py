"""Safely run the opt-in two-user Supabase acceptance tests.

Run this helper from a real local terminal. It signs in two existing development
users, keeps their access tokens only in memory, and passes them only to the
selected live pytest cases through the child process environment. It never
creates users or changes Supabase Auth settings.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import subprocess
import sys
import warnings
from collections.abc import Callable
from pathlib import Path
from typing import IO, Any
from uuid import UUID

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402

DEV_SUPABASE_URL = "https://edbkuunyeyxnyenmmqud.supabase.co"
DAY2_LIVE_TEST_NODE = (
    "tests/test_day2_live.py::test_live_two_user_project_and_session_workflow"
)
DAY3_LIVE_TEST_FILE = "tests/test_day3_live.py"
LIVE_TEST_TIMEOUT_SECONDS = 180
_JWT_PATTERN = re.compile(
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
)


class SafeFailure(Exception):
    """An expected failure whose message contains no credential material."""


def _is_tty(stream: IO[str]) -> bool:
    try:
        return bool(stream.isatty())
    except (AttributeError, OSError):
        return False


def _authenticate_existing_user(
    client: httpx.Client,
    *,
    base_url: str,
    publishable_key: str,
    email: str,
    password: str,
    label: str,
) -> tuple[str, UUID]:
    """Return one existing user's access token and verified user id."""
    try:
        response = client.post(
            f"{base_url}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": publishable_key},
            json={"email": email, "password": password},
        )
    except httpx.HTTPError as exc:
        raise SafeFailure("Unable to reach Supabase Auth.") from exc

    if response.status_code != 200:
        raise SafeFailure(f"Test user {label} sign-in failed.")

    try:
        payload = response.json()
        access_token = payload.get("access_token")
    except (AttributeError, TypeError, ValueError) as exc:
        raise SafeFailure("Supabase Auth returned an invalid response.") from exc
    if not isinstance(access_token, str) or not access_token.strip():
        raise SafeFailure("Supabase Auth returned an invalid response.")

    try:
        user_response = client.get(
            f"{base_url}/auth/v1/user",
            headers={
                "apikey": publishable_key,
                "Authorization": f"Bearer {access_token}",
            },
        )
    except httpx.HTTPError as exc:
        raise SafeFailure("Unable to verify the signed-in development users.") from exc
    if user_response.status_code != 200:
        raise SafeFailure(f"Test user {label} token verification failed.")

    try:
        user_id = UUID(str(user_response.json().get("id")))
    except (AttributeError, TypeError, ValueError) as exc:
        raise SafeFailure("Supabase Auth returned an invalid user response.") from exc
    return access_token, user_id


def _sanitize_output(value: str | bytes | None, sensitive_values: list[str]) -> str:
    if isinstance(value, bytes):
        cleaned = value.decode("utf-8", errors="replace")
    else:
        cleaned = value or ""
    for sensitive in sensitive_values:
        if sensitive:
            cleaned = cleaned.replace(sensitive, "[REDACTED]")
    return _JWT_PATTERN.sub("[REDACTED]", cleaned)


def _write_captured(stream: IO[str], value: str) -> None:
    if not value:
        return
    stream.write(value)
    if not value.endswith("\n"):
        stream.write("\n")


def _clear_secret_list(values: list[str]) -> None:
    """Best-effort removal of references to immutable secret strings."""
    for index in range(len(values)):
        values[index] = ""
    values.clear()


def run_verification(
    *,
    include_day3: bool = False,
    stdin: IO[str] | None = None,
    stdout: IO[str] | None = None,
    stderr: IO[str] | None = None,
    input_reader: Callable[[str], str] = input,
    password_reader: Callable[..., str] = getpass.getpass,
    settings_factory: Callable[[], Any] = Settings,
    client_factory: Callable[..., httpx.Client] = httpx.Client,
    process_runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    process_timeout_seconds: float = LIVE_TEST_TIMEOUT_SECONDS,
) -> int:
    """Authenticate two existing users and run the selected isolated live tests."""
    input_stream = stdin if stdin is not None else sys.stdin
    output_stream = stdout if stdout is not None else sys.stdout
    error_stream = stderr if stderr is not None else sys.stderr

    if not _is_tty(input_stream) or not _is_tty(error_stream):
        error_stream.write(
            "This verifier requires an interactive local terminal; piped input is refused.\n"
        )
        return 2

    publishable_key = ""
    email_a = ""
    email_b = ""
    tokens: list[str] = []
    passwords: list[str] = []
    user_ids: list[UUID] = []
    child_environment: dict[str, str] | None = None

    def sensitive_values() -> list[str]:
        return [*tokens, *passwords, publishable_key, email_a, email_b]

    try:
        try:
            settings = settings_factory()
            if not getattr(settings, "supabase_configured", False):
                raise SafeFailure("Supabase development configuration is incomplete.")
            base_url = str(settings.supabase_url).rstrip("/")
            publishable_key = (
                settings.supabase_publishable_key.get_secret_value().strip()
            )
        except SafeFailure:
            raise
        except Exception as exc:
            raise SafeFailure("Supabase development configuration is invalid.") from exc

        if base_url != DEV_SUPABASE_URL:
            raise SafeFailure(
                "Refusing to run: configure the dedicated Memy AI development project."
            )
        if not publishable_key:
            raise SafeFailure("Supabase development configuration is incomplete.")

        try:
            email_a = input_reader("Existing test user A email: ").strip()
            email_b = input_reader("Existing test user B email: ").strip()
        except (EOFError, KeyboardInterrupt):
            raise
        except Exception as exc:
            raise SafeFailure("Unable to read development-user emails securely.") from exc

        if not email_a or not email_b:
            raise SafeFailure("Enter both existing development-user email addresses.")
        if email_a.casefold() == email_b.casefold():
            raise SafeFailure("Use two different existing development users.")

        labels_and_emails = (("A", email_a), ("B", email_b))
        try:
            with client_factory(
                timeout=settings.request_timeout_seconds,
                follow_redirects=False,
            ) as client:
                for label, email in labels_and_emails:
                    password = ""
                    token = ""
                    try:
                        with warnings.catch_warnings():
                            warnings.simplefilter("error", getpass.GetPassWarning)
                            password = password_reader(
                                f"Existing test user {label} password: ",
                                stream=error_stream,
                            )
                        if not isinstance(password, str) or not password:
                            raise SafeFailure(
                                f"Test user {label} password cannot be empty."
                            )
                        passwords.append(password)
                        output_stream.write(f"Authenticating test user {label}...\n")
                        token, user_id = _authenticate_existing_user(
                            client,
                            base_url=base_url,
                            publishable_key=publishable_key,
                            email=email,
                            password=password,
                            label=label,
                        )
                        tokens.append(token)
                        user_ids.append(user_id)
                        token = ""
                    finally:
                        password = ""
        except getpass.GetPassWarning as exc:
            raise SafeFailure(
                "Secure password input is unavailable; use a real local terminal."
            ) from exc
        except (EOFError, KeyboardInterrupt):
            raise
        except SafeFailure:
            raise
        except Exception as exc:
            raise SafeFailure("Unable to authenticate the development users.") from exc

        if len(user_ids) != 2 or user_ids[0] == user_ids[1]:
            raise SafeFailure("Use two different existing development users.")

        child_environment = os.environ.copy()
        child_environment.pop("RUN_MEMY_DAY3_INTEGRATION", None)
        child_environment.update(
            {
                "PYTHONDONTWRITEBYTECODE": "1",
                "RUN_MEMY_DAY2_INTEGRATION": "1",
                "MEMY_TEST_USER_A_TOKEN": tokens[0],
                "MEMY_TEST_USER_B_TOKEN": tokens[1],
            }
        )
        test_targets = [DAY2_LIVE_TEST_NODE]
        if include_day3:
            child_environment["RUN_MEMY_DAY3_INTEGRATION"] = "1"
            test_targets.append(DAY3_LIVE_TEST_FILE)
        command = [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            *test_targets,
        ]
        output_stream.write("Running the isolated two-user live verification...\n")
        try:
            completed = process_runner(
                command,
                cwd=BACKEND_DIR,
                env=child_environment,
                capture_output=True,
                text=True,
                check=False,
                timeout=process_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            _write_captured(
                output_stream,
                _sanitize_output(exc.stdout, sensitive_values()),
            )
            _write_captured(
                error_stream,
                _sanitize_output(exc.stderr, sensitive_values()),
            )
            error_stream.write("Live verification timed out and was stopped.\n")
            return 124
        except KeyboardInterrupt:
            error_stream.write("Verification cancelled.\n")
            return 130
        except OSError:
            error_stream.write("Unable to start the local pytest process.\n")
            return 2
        except Exception:
            error_stream.write("The local pytest process failed unexpectedly.\n")
            return 2

        sanitized_stdout = _sanitize_output(
            completed.stdout, sensitive_values()
        )
        sanitized_stderr = _sanitize_output(
            completed.stderr, sensitive_values()
        )
        _write_captured(output_stream, sanitized_stdout)
        _write_captured(error_stream, sanitized_stderr)

        if completed.returncode == 0:
            output_stream.write("Two-user live verification passed.\n")
        else:
            error_stream.write("Two-user live verification failed.\n")
        return completed.returncode
    except (EOFError, KeyboardInterrupt):
        error_stream.write("Verification cancelled.\n")
        return 130
    except SafeFailure as exc:
        error_stream.write(f"{exc}\n")
        return 2
    except Exception:
        error_stream.write("Verification failed safely before tests could run.\n")
        return 2
    finally:
        if child_environment is not None:
            child_environment.pop("MEMY_TEST_USER_A_TOKEN", None)
            child_environment.pop("MEMY_TEST_USER_B_TOKEN", None)
            child_environment.pop("RUN_MEMY_DAY3_INTEGRATION", None)
        _clear_secret_list(tokens)
        _clear_secret_list(passwords)
        publishable_key = ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run Memy AI's credential-safe two-user live verification."
    )
    parser.add_argument(
        "--day3",
        action="store_true",
        help="also run the opt-in Day 3 live audio verification",
    )
    arguments = parser.parse_args(argv)
    return run_verification(include_day3=arguments.day3)


if __name__ == "__main__":
    raise SystemExit(main())
