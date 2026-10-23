"""Offline validation of bounded, content-free, self-reported iPhone evidence.

This never runs a device test, opens a socket, loads app settings or certifies
security/privacy/pilot approval. Default input is the all-pending template.
Only fixed classifications, counts and known missing case IDs are printed.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import sys

# Reviewed runtime baseline; later docs/evidence-only commits do not change app code.
BACKEND_COMMIT = "c67687ec4b392dbf0e4f73fc8451ac6f0da05560"
MOBILE_COMMIT = "1d93b74ac9de75c3bdd778d1ad0f9a8ce4449e7e"
DEFAULT_PATH = Path(__file__).resolve().parents[2] / "docs/fixtures/day14-device-evidence.example.json"
MAX_BYTES = 16_384
CASE_IDS = (
    "supabase-login", "create-project-dashboard", "real-m4a-upload",
    "labelled-simulated-transcript", "confirm-correct-memory",
    "explicit-autobiography-generation", "edit-new-revision",
    "open-pdf-on-iphone", "continue-preserves-revisions",
    "signout-signin-restores-data", "cross-user-access-denied",
    "network-interruption-recovery",
)
ATTESTATIONS = {"physical_ios_device", "fictional_data_only", "trusted_transport"}
TOP_FIELDS = {"schema_version", "backend_commit", "mobile_commit", "attestations", "cases"}


class EvidenceError(ValueError):
    """No untrusted field, path or content is retained in an error."""

    def __init__(self, missing=CASE_IDS):
        super().__init__("INVALID_EVIDENCE")
        self.missing = [case_id for case_id in CASE_IDS if case_id in missing]


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceError()
        result[key] = value
    return result


def _constant(_value):
    raise EvidenceError()


def _summary(status, *, passed=0, failed=0, pending=0, missing=(), unconfirmed=0):
    return {
        "result": status,
        "source": "self_reported_device_evidence",
        "counts": {"passed": passed, "failed": failed, "pending": pending,
                   "missing": len(missing), "unconfirmed_attestations": unconfirmed},
        "missing_case_ids": list(missing),
        "independently_verified": False,
        "privacy_release_gate": "PENDING",
        "pilot_approved": False,
    }


def validate_bytes(raw: bytes) -> dict:
    """Accept exact pins and complete case identities, never story text/notes."""
    if type(raw) is not bytes or not 1 <= len(raw) <= MAX_BYTES:
        raise EvidenceError()
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_object, parse_constant=_constant)
    except (UnicodeError, ValueError, RecursionError):
        raise EvidenceError() from None
    if (type(value) is not dict or set(value) != TOP_FIELDS
        or type(value["schema_version"]) is not int or value["schema_version"] != 1
        or value["backend_commit"] != BACKEND_COMMIT or value["mobile_commit"] != MOBILE_COMMIT):
        raise EvidenceError()
    attestations = value["attestations"]
    if (type(attestations) is not dict or set(attestations) != ATTESTATIONS
        or any(type(flag) is not bool for flag in attestations.values())):
        raise EvidenceError()
    cases = value["cases"]
    if type(cases) is not list or len(cases) > len(CASE_IDS):
        raise EvidenceError()
    seen = set()
    counts = {"pass": 0, "fail": 0, "pending": 0}
    for case in cases:
        if (type(case) is not dict or set(case) != {"id", "status"}
            or type(case["id"]) is not str or case["id"] not in CASE_IDS
            or case["id"] in seen or type(case["status"]) is not str
            or case["status"] not in counts):
            raise EvidenceError()
        seen.add(case["id"])
        counts[case["status"]] += 1
    missing = [case_id for case_id in CASE_IDS if case_id not in seen]
    if missing:
        raise EvidenceError(missing)
    unconfirmed = sum(not flag for flag in attestations.values())
    status = ("SELF_REPORTED_FAILURE" if counts["fail"] else
              "PENDING" if counts["pending"] or unconfirmed else "SELF_REPORTED_COMPLETE")
    return _summary(status, passed=counts["pass"], failed=counts["fail"],
                    pending=counts["pending"], unconfirmed=unconfirmed)


def read_evidence(path: Path) -> bytes:
    """Bounded regular-file read; never echo filesystem or decoding errors."""
    descriptor = None
    try:
        if path.is_symlink():
            raise EvidenceError()
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or not 1 <= metadata.st_size <= MAX_BYTES:
            raise EvidenceError()
        with os.fdopen(descriptor, "rb") as source:
            descriptor = None
            raw = source.read(MAX_BYTES + 1)
        if not 1 <= len(raw) <= MAX_BYTES:
            raise EvidenceError()
        return raw
    except (OSError, ValueError):
        raise EvidenceError() from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main(argv=None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    try:
        if len(arguments) > 1:
            raise EvidenceError()
        path = Path(arguments[0]) if arguments else DEFAULT_PATH
        report = validate_bytes(read_evidence(path))
    except EvidenceError as error:
        print(json.dumps(_summary("INVALID_EVIDENCE", missing=error.missing), sort_keys=True))
        return 2
    print(json.dumps(report, sort_keys=True))
    # Zero means a well-formed non-failing report, not that device cases passed.
    # Consumers must inspect result/counts; the default PENDING report exits zero.
    return 1 if report["result"] == "SELF_REPORTED_FAILURE" else 0


if __name__ == "__main__":
    raise SystemExit(main())
