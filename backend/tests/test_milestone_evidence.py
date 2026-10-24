"""Self-reported evidence cannot approve the first milestone or its pilot."""

import builtins
import copy
import json
import socket

import pytest

from scripts import validate_milestone_evidence as evidence


def encoded(value):
    return json.dumps(value).encode()


@pytest.fixture
def template():
    return json.loads(evidence.DEFAULT_PATH.read_bytes())


def reported_complete(template, scope="live_ai"):
    result = copy.deepcopy(template)
    result["pilot_scope"] = scope
    result["device_evidence"]["attestations"] = {
        name: True for name in evidence.device.ATTESTATIONS
    }
    for case in result["device_evidence"]["cases"]:
        case["status"] = "pass"
    for gate in result["gates"]:
        gate["status"] = "pass"
    return result


def assert_not_approved(report):
    for field in ("accepted", "pilot_approved", "release_authorized", "independently_verified"):
        assert report[field] is False
    assert report["required_decision"] == "INDEPENDENT_REVIEW_AND_FOUNDER_APPROVAL_REQUIRED"


def test_template_reuses_exact_device_evidence_and_all_eight_pending_gates(template):
    expected = json.loads(evidence.device.DEFAULT_PATH.read_bytes())
    expected["mobile_commit"] = evidence.MOBILE_COMMIT
    assert template["device_evidence"] == expected
    assert evidence.MOBILE_COMMIT == "b787dcd70b54f6220bfa3d7c0899a2c1f677e080"
    assert [gate["id"] for gate in template["gates"]] == list(evidence.GATE_IDS)
    report = evidence.validate_bytes(encoded(template))
    assert report["result"] == report["device_result"] == "PENDING"
    assert report["counts"] == {"passed": 0, "failed": 0, "pending": 8,
                                "not_applicable": 0, "missing": 0}
    assert_not_approved(report)


def test_all_self_reports_complete_still_do_not_accept_or_approve(template):
    report = evidence.validate_bytes(encoded(reported_complete(template)))
    assert report["result"] == "SELF_REPORTED_COMPLETE_NOT_ACCEPTED"
    assert report["counts"]["passed"] == 8
    assert_not_approved(report)


@pytest.mark.parametrize("gate_id", evidence.GATE_IDS)
def test_each_required_gate_independently_blocks_completion(template, gate_id):
    value = reported_complete(template)
    next(gate for gate in value["gates"] if gate["id"] == gate_id)["status"] = "pending"
    report = evidence.validate_bytes(encoded(value))
    assert report["result"] == "PENDING"
    assert report["counts"]["pending"] == 1
    assert_not_approved(report)


def test_only_mock_scope_can_exempt_live_ai_but_still_needs_manual_acceptance(template):
    value = reported_complete(template, "mock_only")
    next(gate for gate in value["gates"] if gate["id"] == "live-ai-accuracy")["status"] = "not_applicable"
    report = evidence.validate_bytes(encoded(value))
    assert report["result"] == "SELF_REPORTED_COMPLETE_NOT_ACCEPTED"
    assert report["counts"]["not_applicable"] == 1
    assert_not_approved(report)


@pytest.mark.parametrize("gate_id", evidence.GATE_IDS)
def test_no_general_not_applicable_escape_hatch(template, gate_id):
    next(gate for gate in template["gates"] if gate["id"] == gate_id)["status"] = "not_applicable"
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


def test_undecided_pilot_scope_cannot_be_reported_complete(template):
    report = evidence.validate_bytes(encoded(reported_complete(template, "undecided")))
    assert report["result"] == "PENDING"
    assert_not_approved(report)


@pytest.mark.parametrize("mutation", ["pending-case", "failed-case", "unconfirmed-attestation"])
def test_device_gate_cannot_pass_if_embedded_device_evidence_is_incomplete(template, mutation):
    value = reported_complete(template)
    if mutation == "unconfirmed-attestation":
        value["device_evidence"]["attestations"]["physical_ios_device"] = False
    else:
        value["device_evidence"]["cases"][0]["status"] = "pending" if mutation == "pending-case" else "fail"
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(value))


def test_failed_embedded_device_case_prevents_masking_by_pending_gate(template):
    template["device_evidence"]["cases"][0]["status"] = "fail"
    report = evidence.validate_bytes(encoded(template))
    assert report["result"] == "SELF_REPORTED_FAILURE"
    assert report["device_result"] == "SELF_REPORTED_FAILURE"
    assert_not_approved(report)


def test_reported_failed_gate_cannot_be_masked_by_other_passes(template):
    value = reported_complete(template)
    value["gates"][0]["status"] = "fail"
    report = evidence.validate_bytes(encoded(value))
    assert report["result"] == "SELF_REPORTED_FAILURE"
    assert report["counts"]["failed"] == 1
    assert_not_approved(report)


@pytest.mark.parametrize("mutation", ["duplicate", "unknown", "unknown-status", "extra", "non-object"])
def test_gate_ids_and_shapes_are_strict(template, mutation):
    if mutation == "duplicate":
        template["gates"][1] = dict(template["gates"][0])
    elif mutation == "unknown":
        template["gates"][0]["id"] = "PRIVATE_GATE"
    elif mutation == "unknown-status":
        template["gates"][0]["status"] = "approved"
    elif mutation == "extra":
        template["gates"].append(dict(template["gates"][0]))
    else:
        template["gates"][0] = None
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


def test_missing_gate_identifies_only_known_missing_gate(template):
    removed = template["gates"].pop()
    with pytest.raises(evidence.EvidenceError) as caught:
        evidence.validate_bytes(encoded(template))
    assert caught.value.missing == [removed["id"]]


@pytest.mark.parametrize("location", ["top", "gate", "device", "device-case"])
def test_free_text_secrets_signatures_and_testcount_cannot_be_submitted_as_proof(template, location):
    target = {"top": template, "gate": template["gates"][0],
              "device": template["device_evidence"],
              "device-case": template["device_evidence"]["cases"][0]}[location]
    target["signed_proof_or_testcount"] = "PRIVATE_VALUE_NOT_ECHOED"
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


@pytest.mark.parametrize("field,value", [("schema_version", True), ("schema_version", 1.0),
    ("schema_version", 2), ("pilot_scope", "approved"), ("pilot_scope", None),
    ("pilot_scope", []), ("gates", {}), ("device_evidence", [])])
def test_wrong_types_scopes_and_versions_are_rejected(template, field, value):
    template[field] = value
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


@pytest.mark.parametrize("raw", [b'{"schema_version":1,"schema_version":1}',
    b'{"schema_version":NaN}', b'{"gates":Infinity}', b'null', b'[]', b'"private"',
    b'\xff', b'{', b'', b'[' * 3000 + b']' * 3000])
def test_strict_parser_rejects_duplicate_fields_non_json_constants_and_recursion(raw):
    with pytest.raises(evidence.EvidenceError, match="^INVALID_EVIDENCE$"):
        evidence.validate_bytes(raw)


def test_unreviewed_device_revisions_are_rejected(template):
    template["device_evidence"]["mobile_commit"] = "0" * 40
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(encoded(template))


def test_day14_historical_cli_pair_remains_unchanged_and_not_silently_promoted():
    historical = evidence.device.read_evidence(evidence.device.DEFAULT_PATH)
    assert evidence.device.validate_bytes(historical)["result"] == "PENDING"
    with pytest.raises(evidence.device.EvidenceError):
        evidence.device.validate_bytes(historical, expected_mobile=evidence.MOBILE_COMMIT)


def test_oversized_content_is_bounded_before_json_parsing():
    with pytest.raises(evidence.EvidenceError):
        evidence.validate_bytes(b" " * (evidence.device.MAX_BYTES + 1))


def test_cli_pending_is_nonzero_and_offline_without_environment_or_app(monkeypatch, capsys):
    def denied(*_args, **_kwargs):
        raise AssertionError("No network permitted")
    monkeypatch.setattr(socket, "socket", denied)
    original = builtins.__import__
    def guarded_import(name, *args, **kwargs):
        assert name.split(".")[0] not in {"app", "dotenv", "httpx", "requests"}
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", guarded_import)
    assert evidence.main([]) == 3
    report = json.loads(capsys.readouterr().out)
    assert report["result"] == "PENDING"
    assert_not_approved(report)


def test_cli_complete_self_report_still_has_no_success_exit(template, tmp_path, capsys):
    path = tmp_path / "report.json"
    path.write_bytes(encoded(reported_complete(template)))
    assert evidence.main([str(path)]) == 3
    report = json.loads(capsys.readouterr().out)
    assert report["result"] == "SELF_REPORTED_COMPLETE_NOT_ACCEPTED"
    assert_not_approved(report)


def test_cli_failed_report_is_nonzero(template, tmp_path, capsys):
    template["gates"][0]["status"] = "fail"
    path = tmp_path / "report.json"
    path.write_bytes(encoded(template))
    assert evidence.main([str(path)]) == 1
    assert json.loads(capsys.readouterr().out)["result"] == "SELF_REPORTED_FAILURE"


@pytest.mark.parametrize("kind", ["symlink", "directory", "missing", "oversize", "private", "extra-args"])
def test_cli_filesystem_and_parser_failures_never_echo_paths_or_content(tmp_path, kind, capsys):
    path = tmp_path / "PRIVATE_PATH.json"
    args = [str(path)]
    if kind == "symlink":
        path.symlink_to(evidence.DEFAULT_PATH)
    elif kind == "directory":
        path.mkdir()
    elif kind == "oversize":
        path.write_bytes(b" " * (evidence.device.MAX_BYTES + 1))
    elif kind == "private":
        path.write_text('{"password":"PRIVATE_TOKEN"}')
    elif kind == "extra-args":
        args.append("PRIVATE_TOKEN")
    assert evidence.main(args) == 2
    output = capsys.readouterr()
    assert "PRIVATE" not in output.out + output.err
    assert json.loads(output.out)["result"] == "INVALID_EVIDENCE"
