"""No network or real identities: safe count-only inventory and closed failures."""

import asyncio
import json
import warnings
from uuid import UUID

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import APIError
from app.services.auth import AuthenticatedUser
from app.services.privacy_inventory import RELATIONS, inventory_visible_data
from scripts import privacy_inventory as cli

USER = AuthenticatedUser(UUID("11111111-1111-4111-8111-111111111111"), SecretStr("synthetic-user-token"))
SETTINGS = Settings(_env_file=None, supabase_url="https://example.supabase.co",
                    supabase_publishable_key="synthetic-publishable")


def inventory(handler, settings=SETTINGS):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True) as client:
            return await inventory_visible_data(settings, client, USER)
    return asyncio.run(scenario())


def test_settings_probe_uses_its_existing_granted_primary_key_not_an_invented_id():
    # user_settings uses user_id as its PK and has column-specific SELECT grants.
    assert next(item for item in RELATIONS if item[0] == "user_settings") == (
        "user_settings", "user_id", "user_id")


def test_inventory_uses_only_head_zero_rows_auth_and_fixed_columns():
    visited = []

    def upstream(request):
        assert request.method == "HEAD"
        relation = request.url.path.split("/")[-1]
        assert request.url.params["limit"] == "0"
        column, owner = next((col, owner) for name, col, owner in RELATIONS if name == relation)
        assert request.url.params["select"] == column
        assert request.headers["authorization"] == "Bearer synthetic-user-token"
        assert request.headers["prefer"] == "count=exact"
        if owner:
            assert request.url.params[owner] == "eq." + str(USER.id)
        visited.append(relation)
        return httpx.Response(200, headers={"Content-Range": "*/2"})

    report = inventory(upstream)
    assert visited == [item[0] for item in RELATIONS]
    assert report["counts"] == {item[0]: 2 for item in RELATIONS}
    assert report["deleted"] is False and report["complete_erasure_inventory"] is False
    rendered = json.dumps(report)
    for forbidden in (str(USER.id), "synthetic-user-token", "synthetic-publishable", "email"):
        assert forbidden not in rendered
    assert report["counts_are_additive"] is False


@pytest.mark.parametrize("header", [None, "", "*/*", "*/-1", "*/1.5", "*/99999999999999999999", "*/9223372036854775808", "garbage-private-story"])
def test_unknown_counts_never_turn_into_zero_or_success(header):
    headers = {} if header is None else {"Content-Range": header}
    with pytest.raises(APIError) as failure:
        inventory(lambda request: httpx.Response(200, headers=headers))
    assert failure.value.code == "PRIVACY_INVENTORY_UNAVAILABLE"
    assert "private-story" not in failure.value.message


@pytest.mark.parametrize("status", [301, 302, 400, 401, 403, 404, 429, 500])
def test_upstream_error_stops_without_partial_report_or_redirect(status):
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(status, headers={"Location": "https://untrusted.example/path"}, text="private-error")

    with pytest.raises(APIError) as failure:
        inventory(upstream)
    assert len(calls) == 1
    assert failure.value.code == ("INVALID_ACCESS_TOKEN" if status == 401 else "PRIVACY_INVENTORY_UNAVAILABLE")
    assert "private-error" not in failure.value.message


def test_timeout_and_missing_configuration_fail_closed():
    def upstream(request):
        raise httpx.ReadTimeout("private-token-and-title", request=request)

    with pytest.raises(APIError):
        inventory(upstream)
    with pytest.raises(APIError):
        inventory(lambda request: pytest.fail("Unconfigured inventory must not connect"), Settings(_env_file=None))


def test_default_cli_never_loads_credentials_prompts_or_contacts_network(monkeypatch, capsys):
    monkeypatch.setattr(cli, "Settings", lambda: pytest.fail("Offline must not load env"))
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt: pytest.fail("Offline must not ask for a token"))
    assert cli.main([]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["network_calls"] == 0 and output["deleted"] is False


def test_cli_live_count_rejects_wrong_project_without_token_prompt(monkeypatch, capsys):
    monkeypatch.setattr(cli, "Settings", lambda: SETTINGS)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt: pytest.fail("Wrong project must not prompt"))
    assert cli.main(["--run"]) == 2
    assert capsys.readouterr().out == ""


def test_cli_will_not_fall_back_to_echoed_token_entry(monkeypatch, capsys):
    settings = Settings(_env_file=None, supabase_url=cli.DEV_SUPABASE_URL,
                        supabase_publishable_key="synthetic-publishable")
    monkeypatch.setattr(cli, "Settings", lambda: settings)

    def unsafe_prompt(prompt):
        warnings.warn("Cannot hide input", cli.getpass.GetPassWarning)
        pytest.fail("Token must not be read if input cannot be hidden")

    monkeypatch.setattr(cli.getpass, "getpass", unsafe_prompt)
    assert cli.main(["--run"]) == 2
    output = capsys.readouterr()
    assert output.out == "" and "no deletion" in output.err
