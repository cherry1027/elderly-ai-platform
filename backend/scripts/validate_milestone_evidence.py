"""Validate content-free Milestone 1 reports without approving a pilot.

Reuses the Day 14 bounded file reader, strict JSON hooks and pinned device
validator. No environment, app, network, provider or credential access occurs.
Every gate is a self-report requiring independent review. Exit 3 means valid
but NOT accepted, even if every required item is reported complete; this tool
has no automatic acceptance/exit-0 path.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

if __package__:
    from . import validate_day14_evidence as device
else:
    import validate_day14_evidence as device


DEFAULT_PATH = Path(__file__).resolve().parents[2] / "docs/fixtures/milestone-1-evidence.example.json"
BACKEND_COMMIT = device.BACKEND_COMMIT
MOBILE_COMMIT = "b787dcd70b54f6220bfa3d7c0899a2c1f677e080"
GATE_IDS = (
    "backend-regressions", "hosted-two-user-jwt", "physical-iphone",
    "mobile-retry-backoff", "legacy-edge-security", "controller-retention-deletion",
    "live-ai-accuracy", "founders-pilot-scope",
)
TOP_FIELDS = {"schema_version", "pilot_scope", "device_evidence", "gates"}
SCOPES = {"undecided", "mock_only", "live_ai"}
STATUSES = {"pending", "pass", "fail", "not_applicable"}


class EvidenceError(ValueError):
    """Only fixed known gate identities may be carried into sanitized output."""

    def __init__(self, missing=GATE_IDS):
        super().__init__("INVALID_EVIDENCE")
        self.missing = [gate_id for gate_id in GATE_IDS if gate_id in missing]


def _summary(result, *, counts=None, missing=(), scope="undecided", device_report=None):
    return {
        "result": result,
        "source": "self_reported_milestone_evidence",
        "pilot_scope": scope,
        "counts": counts or {"passed": 0, "failed": 0, "pending": 0,
                             "not_applicable": 0, "missing": len(missing)},
        "missing_gate_ids": list(missing),
        "device_result": device_report["result"] if device_report else "NOT_VALIDATED",
        "independently_verified": False,
        "accepted": False,
        "pilot_approved": False,
        "release_authorized": False,
        "required_decision": "INDEPENDENT_REVIEW_AND_FOUNDER_APPROVAL_REQUIRED",
    }


def validate_bytes(raw: bytes) -> dict:
    """Validate the eight gate identities and existing twelve-case device schema.

    No numeric test count or free-text claim can be supplied as release proof.
    A mock-only scope can mark live AI quality not applicable, never the other
    gates. A device pass requires all pinned Day 14 cases/attestations complete.
    Even then it is only self-reported, not independently verified acceptance.
    """
    if type(raw) is not bytes or not 1 <= len(raw) <= device.MAX_BYTES:
        raise EvidenceError()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=device._object,
                           parse_constant=device._constant)
    except (UnicodeError, ValueError, RecursionError):
        raise EvidenceError() from None
    if (type(value) is not dict or set(value) != TOP_FIELDS
        or type(value["schema_version"]) is not int or value["schema_version"] != 1
        or type(value["pilot_scope"]) is not str or value["pilot_scope"] not in SCOPES):
        raise EvidenceError()
    try:
        device_report = device.validate_bytes(json.dumps(value["device_evidence"]).encode(),
                                              expected_backend=BACKEND_COMMIT,
                                              expected_mobile=MOBILE_COMMIT)
    except (device.EvidenceError, TypeError, ValueError, RecursionError):
        raise EvidenceError() from None
    gates = value["gates"]
    if type(gates) is not list or len(gates) > len(GATE_IDS):
        raise EvidenceError()
    states = {}
    for gate in gates:
        if (type(gate) is not dict or set(gate) != {"id", "status"}
            or type(gate["id"]) is not str or gate["id"] not in GATE_IDS
            or gate["id"] in states or type(gate["status"]) is not str
            or gate["status"] not in STATUSES):
            raise EvidenceError()
        if gate["status"] == "not_applicable" and not (
            gate["id"] == "live-ai-accuracy" and value["pilot_scope"] == "mock_only"
        ):
            raise EvidenceError()
        states[gate["id"]] = gate["status"]
    missing = [gate_id for gate_id in GATE_IDS if gate_id not in states]
    if missing:
        raise EvidenceError(missing)
    if (states["physical-iphone"] == "pass"
        and device_report["result"] != "SELF_REPORTED_COMPLETE"):
        raise EvidenceError()
    counts = {"passed": sum(state == "pass" for state in states.values()),
              "failed": sum(state == "fail" for state in states.values()),
              "pending": sum(state == "pending" for state in states.values()),
              "not_applicable": sum(state == "not_applicable" for state in states.values()),
              "missing": 0}
    result = ("SELF_REPORTED_FAILURE" if counts["failed"] or device_report["result"] == "SELF_REPORTED_FAILURE"
              else "PENDING" if counts["pending"] or value["pilot_scope"] == "undecided"
              or device_report["result"] != "SELF_REPORTED_COMPLETE"
              else "SELF_REPORTED_COMPLETE_NOT_ACCEPTED")
    return _summary(result, counts=counts, scope=value["pilot_scope"], device_report=device_report)


def main(argv=None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    try:
        if len(arguments) > 1:
            raise EvidenceError()
        path = Path(arguments[0]) if arguments else DEFAULT_PATH
        report = validate_bytes(device.read_evidence(path))
    except (EvidenceError, device.EvidenceError) as error:
        missing = error.missing if isinstance(error, EvidenceError) else GATE_IDS
        print(json.dumps(_summary("INVALID_EVIDENCE", missing=missing), sort_keys=True))
        return 2
    print(json.dumps(report, sort_keys=True))
    # Never report successful release acceptance from a file of self-reports.
    return 1 if report["result"] == "SELF_REPORTED_FAILURE" else 3


if __name__ == "__main__":
    raise SystemExit(main())
