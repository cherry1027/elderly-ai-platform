"""The evidence checker cannot promote pending/self-reported data to release proof."""

import builtins
import copy
import json
import socket

import pytest

from scripts import validate_day14_evidence as evidence


@pytest.fixture
def template():
    return json.loads(evidence.DEFAULT_PATH.read_bytes())


def encoded(value):
    return json.dumps(value).encode()


def complete(template):
    result = copy.deepcopy(template)
    result["attestations"] = {name: True for name in evidence.ATTESTATIONS}
    for case in result["cases"]:
        case["status"] = "pass"
    return result


def test_example_is_exact_all_pending_template_and_never_passes(template):
    assert template["backend_commit"] == evidence.BACKEND_COMMIT
    assert template["mobile_commit"] == evidence.MOBILE_COMMIT
    assert [case["id"] for case in template["cases"]] == list(evidence.CASE_IDS)
    report = evidence.validate_bytes(encoded(template))
    assert report["result"] == "PENDING"
    assert report["counts"] == {"passed": 0, "failed": 0, "pending": 12, "missing": 0,
                                "unconfirmed_attestations": 3}
    assert "PASS" not in json.dumps(report)


def test_complete_is_explicitly_only_self_reported_and_privacy_always_pending(template):
    report = evidence.validate_bytes(encoded(complete(template)))
    assert report["result"] == "SELF_REPORTED_COMPLETE"
    assert report["counts"]["passed"] == 12
    assert report["independently_verified"] is False
    assert report["pilot_approved"] is False
    assert report["privacy_release_gate"] == "PENDING"
    assert set(report) == {"result", "source", "counts", "missing_case_ids", "independently_verified",
                           "privacy_release_gate", "pilot_approved"}


@pytest.mark.parametrize("attestation", sorted(evidence.ATTESTATIONS))
def test_each_required_attestation_blocks_completion(template, attestation):
    value = complete(template)
    value["attestations"][attestation] = False
    report = evidence.validate_bytes(encoded(value))
    assert report["result"] == "PENDING"
    assert report["counts"]["unconfirmed_attestations"] == 1


@pytest.mark.parametrize("case_id", evidence.CASE_IDS)
def test_each_of_twelve_pending_device_cases_blocks_completion(template, case_id):
    value = complete(template)
    next(case for case in value["cases"] if case["id"] == case_id)["status"] = "pending"
    report = evidence.validate_bytes(encoded(value))
    assert report["result"] == "PENDING"
    assert report["counts"]["pending"] == 1


def test_failed_case_is_not_pass_or_pilot_approval(template):
    value = complete(template)
    value["cases"][0]["status"] = "fail"
    report = evidence.validate_bytes(encoded(value))
    assert report["result"] == "SELF_REPORTED_FAILURE"
    assert report["counts"]["failed"] == 1
    assert report["pilot_approved"] is False


@pytest.mark.parametrize("field", sorted(evidence.TOP_FIELDS))
def test_missing_top_level_fields_rejected(template, field):
    del template[field]
    with pytest.raises(evidence.EvidenceError, match="^INVALID_EVIDENCE$"):
        evidence.validate_bytes(encoded(template))


def test_missing_case_reports_only_known_missing_identifier(template):
    removed = template["cases"].pop(3)
    with pytest.raises(evidence.EvidenceError) as caught:
        evidence.validate_bytes(encoded(template))
    assert caught.value.missing == [removed["id"]]


@pytest.mark.parametrize("location", ["top", "case", "attestation"])
def test_unknown_fields_and_private_notes_rejected(template, location):
    target = template if location == "top" else template["cases"][0] if location == "case" else template["attestations"]
    target["private_notes"] = "NEVER_ECHO_PRIVATE_CONTENT"
    with pytest.raises(evidence.EvidenceError, match="^INVALID_EVIDENCE$"):
        evidence.validate_bytes(encoded(template))


@pytest.mark.parametrize("raw", [
    b'{"schema_version":1,"schema_version":1}',
    b'{"cases":[{"id":"supabase-login","id":"real-m4a-upload","status":"pass"}]}',
    b'{"attestations":{"physical_ios_device":true,"physical_ios_device":false}}',
    b'{"schema_version":NaN}', b'{"schema_version":Infinity}', b'{"schema_version":-Infinity}',
    b'\xff', b'{', b'null', b'[]', b'"private text"', b'',
    b'[' * 3000 + b']' * 3000,
])
def test_duplicate_fields_non_json_constants_and_malformed_data_rejected(raw):
    with pytest.raises(evidence.EvidenceError, match="^INVALID_EVIDENCE$"):
        evidence.validate_bytes(raw)


@pytest.mark.parametrize("field,value", [("schema_version", True), ("schema_version", 1.0),
    ("schema_version", 2), ("backend_commit", "unknown"), ("mobile_commit", "unknown"),
    ("cases", {}), ("attestations", [])])
def test_wrong_types_versions_and_unreviewed_revisions_rejected(template, field, value):
    template[field] = value
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


@pytest.mark.parametrize("value", [1, 0, "true", None])
def test_attestations_require_exact_booleans(template, value):
    template["attestations"]["physical_ios_device"] = value
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


@pytest.mark.parametrize("mutation", ["duplicate", "unknown-id", "unknown-status", "extra-case", "non-object"])
def test_invalid_case_records_rejected(template, mutation):
    if mutation == "duplicate":
        template["cases"][1] = dict(template["cases"][0])
    elif mutation == "unknown-id":
        template["cases"][0]["id"] = "PRIVATE_CASE_MUST_NOT_BE_ECHOED"
    elif mutation == "unknown-status":
        template["cases"][0]["status"] = "PASS"
    elif mutation == "extra-case":
        template["cases"].append(dict(template["cases"][0]))
    else:
        template["cases"][0] = None
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


def test_oversize_memory_and_file_inputs_rejected(tmp_path):
    raw = b" " * (evidence.MAX_BYTES + 1)
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(raw)
    path = tmp_path / "oversize.json"
    path.write_bytes(raw)
    with pytest.raises(evidence.EvidenceError):
        evidence.read_evidence(path)


def test_symlink_and_nonregular_paths_rejected(tmp_path):
    path = tmp_path / "evidence-link.json"
    path.symlink_to(evidence.DEFAULT_PATH)
    for candidate in (path, tmp_path, tmp_path / "missing-private-path"):
        with pytest.raises(evidence.EvidenceError, match="^INVALID_EVIDENCE$"):
            evidence.read_evidence(candidate)


def test_cli_default_is_offline_and_does_not_import_app_or_load_env(monkeypatch, capsys):
    def denied(*_args, **_kwargs):
        raise AssertionError("No network permitted")
    monkeypatch.setattr(socket, "socket", denied)
    original = builtins.__import__
    def guarded_import(name, *args, **kwargs):
        assert name.split(".")[0] not in {"app", "dotenv", "httpx", "requests"}
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", guarded_import)
    assert evidence.main([]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["result"] == "PENDING"
    assert report["counts"]["pending"] == 12


def test_cli_never_echoes_untrusted_content_paths_or_parser_errors(tmp_path, capsys):
    path = tmp_path / "PRIVATE_PATH_DO_NOT_ECHO.json"
    path.write_text('{"password":"PRIVATE_TOKEN_DO_NOT_ECHO"}')
    assert evidence.main([str(path)]) == 2
    output = capsys.readouterr()
    assert "PRIVATE" not in output.out + output.err
    assert json.loads(output.out)["result"] == "INVALID_EVIDENCE"


def test_cli_reports_missing_case_and_failure_only_as_sanitized_summary(template, tmp_path, capsys):
    path = tmp_path / "report.json"
    value = complete(template)
    value["cases"][0]["status"] = "fail"
    path.write_bytes(encoded(value))
    assert evidence.main([str(path)]) == 1
    report = json.loads(capsys.readouterr().out)
    assert report["result"] == "SELF_REPORTED_FAILURE"
    assert "cases" not in report and "attestations" not in report
    value["cases"].pop()
    path.write_bytes(encoded(value))
    assert evidence.main([str(path)]) == 2
    assert json.loads(capsys.readouterr().out)["missing_case_ids"] == [evidence.CASE_IDS[-1]]


def test_cli_extra_arguments_are_sanitized(capsys):
    assert evidence.main(["PRIVATE_ARGUMENT", "PRIVATE_TOKEN"]) == 2
    assert "PRIVATE" not in capsys.readouterr().out
