"""Create two temporary anonymous users and run the gated live acceptance tests.

This helper is intentionally narrow:

* it runs only against Memy AI's dedicated development Supabase project;
* it uses the public anonymous-signup flow, never an admin/service-role key;
* access tokens exist only in memory and in the child pytest environment;
* it never changes Auth settings and cannot delete Auth users;
* it prints only the run marker, created user IDs, and a result/cleanup summary.

Anonymous Auth users are durable. After every run, an operator must delete the
reported IDs (or users bearing the reported marker) in the Supabase dashboard.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import IO, Any
from uuid import UUID, uuid4

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from scripts.verify_two_users import (  # noqa: E402
    DAY2_LIVE_TEST_NODE,
    DAY3_LIVE_TEST_FILE,
    DEV_SUPABASE_URL,
    LIVE_TEST_TIMEOUT_SECONDS,
    SafeFailure,
    _clear_secret_list,
    _sanitize_output,
)


OPT_IN_VARIABLE = "RUN_MEMY_ANONYMOUS_ACCEPTANCE"
RUN_METADATA_KEY = "memy_acceptance_run"
LABEL_METADATA_KEY = "memy_acceptance_label"
AUTH_API_VERSION = "2024-01-01"
_MARKER_PATTERN = re.compile(r"memy-anonymous-acceptance-[A-Za-z0-9-]{16,96}\Z")


def _new_run_marker() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"memy-anonymous-acceptance-{timestamp}-{uuid4().hex}"


def _signup_anonymous_user(
    client: httpx.Client,
    *,
    base_url: str,
    publishable_key: str,
    marker: str,
    label: str,
    remember_created: Callable[[str, UUID], None],
) -> tuple[str, UUID]:
    """Create and independently verify one public anonymous Auth session.

    The request mirrors ``@supabase/auth-js`` ``signInAnonymously``: POST to
    ``/signup`` with public client headers, custom ``data``, and an empty
    ``gotrue_meta_security`` object when no CAPTCHA token is supplied.
    """
    public_headers = {
        "apikey": publishable_key,
        "Authorization": f"Bearer {publishable_key}",
        "X-Supabase-Api-Version": AUTH_API_VERSION,
    }
    try:
        response = client.post(
            f"{base_url}/auth/v1/signup",
            headers=public_headers,
            json={
                "data": {
                    RUN_METADATA_KEY: marker,
                    LABEL_METADATA_KEY: label,
                },
                "gotrue_meta_security": {},
            },
        )
    except httpx.HTTPError as exc:
        raise SafeFailure(
            f"Anonymous user {label} signup could not reach Supabase Auth."
        ) from exc
    if not 200 <= response.status_code < 300:
        raise SafeFailure(f"Anonymous user {label} signup failed.")

    try:
        payload = response.json()
        token = payload.get("access_token")
        signup_user = payload.get("user")
        signup_id = UUID(str(signup_user.get("id")))
    except (AttributeError, TypeError, ValueError) as exc:
        raise SafeFailure(f"Anonymous user {label} signup returned an invalid response.") from exc

    # Record the durable identity as soon as the signup response identifies it,
    # so a later verification failure still produces an exact cleanup target.
    remember_created(label, signup_id)
    if not isinstance(token, str) or not token.strip():
        raise SafeFailure(f"Anonymous user {label} signup returned no session.")

    try:
        user_response = client.get(
            f"{base_url}/auth/v1/user",
            headers={
                "apikey": publishable_key,
                "Authorization": f"Bearer {token}",
            },
        )
    except httpx.HTTPError as exc:
        raise SafeFailure(f"Anonymous user {label} could not be verified online.") from exc
    if user_response.status_code != 200:
        raise SafeFailure(f"Anonymous user {label} online verification failed.")

    try:
        user = user_response.json()
        verified_id = UUID(str(user.get("id")))
        metadata = user.get("user_metadata")
        if user.get("is_anonymous") is not True:
            raise ValueError
        if not isinstance(metadata, dict):
            raise ValueError
        if metadata.get(RUN_METADATA_KEY) != marker:
            raise ValueError
        if metadata.get(LABEL_METADATA_KEY) != label:
            raise ValueError
        if verified_id != signup_id:
            raise ValueError
    except (AttributeError, TypeError, ValueError) as exc:
        raise SafeFailure(
            f"Anonymous user {label} did not verify as the expected anonymous identity."
        ) from exc
    return token, verified_id


def run_anonymous_verification(
    *,
    environ: Mapping[str, str] | None = None,
    stdout: IO[str] | None = None,
    settings_factory: Callable[[], Any] = Settings,
    client_factory: Callable[..., httpx.Client] = httpx.Client,
    process_runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    marker_factory: Callable[[], str] = _new_run_marker,
    process_timeout_seconds: float = LIVE_TEST_TIMEOUT_SECONDS,
) -> int:
    """Create two anonymous identities and run Day 2 plus Day 3 acceptance."""
    source_environment = environ if environ is not None else os.environ
    output = stdout if stdout is not None else sys.stdout
    if source_environment.get(OPT_IN_VARIABLE) != "1":
        output.write(f"Result: not run; set {OPT_IN_VARIABLE}=1 for explicit opt-in.\n")
        return 2

    marker = ""
    publishable_key = ""
    tokens: list[str] = []
    created: dict[str, UUID] = {}
    child_environment: dict[str, str] | None = None
    result_message = "failed safely before tests ran"
    exit_code = 2

    def remember_created(label: str, user_id: UUID) -> None:
        previous = created.get(label)
        if previous is not None and previous != user_id:
            raise SafeFailure("Supabase Auth returned inconsistent anonymous identities.")
        created[label] = user_id

    def sensitive_values() -> list[str]:
        return [*tokens, publishable_key]

    try:
        try:
            settings = settings_factory()
            if not getattr(settings, "supabase_configured", False):
                raise SafeFailure("Supabase development configuration is incomplete.")
            base_url = str(settings.supabase_url).rstrip("/")
            publishable_key = settings.supabase_publishable_key.get_secret_value().strip()
        except SafeFailure:
            raise
        except Exception as exc:
            raise SafeFailure("Supabase development configuration is invalid.") from exc
        if base_url != DEV_SUPABASE_URL:
            raise SafeFailure(
                "Refusing to run outside the dedicated Memy AI development project."
            )
        if not publishable_key:
            raise SafeFailure("Supabase development configuration is incomplete.")

        candidate_marker = marker_factory()
        if (
            not isinstance(candidate_marker, str)
            or _MARKER_PATTERN.fullmatch(candidate_marker) is None
        ):
            raise SafeFailure("Unable to create a safe anonymous-acceptance run marker.")
        marker = candidate_marker

        try:
            with client_factory(
                timeout=settings.request_timeout_seconds,
                follow_redirects=False,
            ) as client:
                for label in ("A", "B"):
                    token, user_id = _signup_anonymous_user(
                        client,
                        base_url=base_url,
                        publishable_key=publishable_key,
                        marker=marker,
                        label=label,
                        remember_created=remember_created,
                    )
                    tokens.append(token)
                    if user_id != created[label]:
                        raise SafeFailure(
                            "Supabase Auth returned inconsistent anonymous identities."
                        )
        except SafeFailure:
            raise
        except Exception as exc:
            raise SafeFailure("Anonymous Auth setup failed safely.") from exc

        if len(tokens) != 2 or set(created) != {"A", "B"}:
            raise SafeFailure("Two verified anonymous users are required.")
        if created["A"] == created["B"]:
            raise SafeFailure("Supabase Auth returned the same identity twice.")

        child_environment = dict(source_environment)
        child_environment.pop(OPT_IN_VARIABLE, None)
        child_environment.update(
            {
                "PYTHONDONTWRITEBYTECODE": "1",
                "RUN_MEMY_DAY2_INTEGRATION": "1",
                "RUN_MEMY_DAY3_INTEGRATION": "1",
                "MEMY_TEST_USER_A_TOKEN": tokens[0],
                "MEMY_TEST_USER_B_TOKEN": tokens[1],
            }
        )
        command = [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            DAY2_LIVE_TEST_NODE,
            DAY3_LIVE_TEST_FILE,
        ]
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
            # Sanitize even though captured test output is deliberately not
            # emitted; this keeps future handling safe by construction.
            _sanitize_output(exc.stdout, sensitive_values())
            _sanitize_output(exc.stderr, sensitive_values())
            result_message = "acceptance tests timed out and were stopped"
            exit_code = 124
        except KeyboardInterrupt:
            result_message = "cancelled"
            exit_code = 130
        except OSError:
            result_message = "could not start the local acceptance tests"
            exit_code = 2
        except Exception:
            result_message = "local acceptance test execution failed safely"
            exit_code = 2
        else:
            _sanitize_output(completed.stdout, sensitive_values())
            _sanitize_output(completed.stderr, sensitive_values())
            exit_code = completed.returncode
            result_message = (
                "Day 2 and Day 3 acceptance tests passed"
                if completed.returncode == 0
                else f"Day 2 and Day 3 acceptance tests failed (exit {completed.returncode})"
            )
    except SafeFailure as exc:
        # SafeFailure messages are hard-coded and contain no upstream body.
        result_message = str(exc)
        exit_code = 2
    except KeyboardInterrupt:
        result_message = "cancelled"
        exit_code = 130
    except Exception:
        result_message = "verification failed safely"
        exit_code = 2
    finally:
        if child_environment is not None:
            child_environment.pop("MEMY_TEST_USER_A_TOKEN", None)
            child_environment.pop("MEMY_TEST_USER_B_TOKEN", None)
            child_environment.pop("RUN_MEMY_DAY2_INTEGRATION", None)
            child_environment.pop("RUN_MEMY_DAY3_INTEGRATION", None)
        if marker:
            output.write(f"Run marker: {marker}\n")
        for label in ("A", "B"):
            if label in created:
                output.write(f"Anonymous user {label} UID: {created[label]}\n")
        output.write(f"Result: {result_message.rstrip('.')}.\n")
        if created:
            output.write(
                "Cleanup required: manually delete the exact anonymous Auth user IDs "
                "listed above (matching this run marker) in the Supabase dashboard.\n"
            )
        _clear_secret_list(tokens)
        publishable_key = ""
    return exit_code


def main() -> int:
    return run_anonymous_verification()


if __name__ == "__main__":
    raise SystemExit(main())
