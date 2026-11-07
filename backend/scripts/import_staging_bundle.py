"""Import one authenticated, bounded state bundle into a NEW private directory.

No provider call, fresh ledger, budget reset, control rewrite or activation.
Encoder helper accepts seven already-reviewed byte strings in memory. The CLI
reads only its ciphertext file and the existing speech key from the environment.
"""
from __future__ import annotations

import argparse
import base64
from collections.abc import Mapping
import hashlib
import hmac
from io import BytesIO
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import time
import zipfile

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
from app.services.ai_budget import accounting, load_policy, validate_ceiling_chain
from app.services.ai_controls import _load_approval, _unique_object
from app.services.pilot_cohort import load_cohort
from scripts.staging_state import (
    ledger_connection, private_directory, read_private, restore_new,
    verify_backup, verify_history, write_new,
)

EXPECTED_SERVICE_ID = "srv-dbngm5e417fc73dndsng"
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_ENVELOPE_BYTES = ((MAX_BUNDLE_BYTES + 16 + 2) // 3) * 4 + 4096
MAX_WINDOW_MICROUSD = 20_000_000
REMOTE_HOLD_MICROUSD = 750_000
MODELS = frozenset({"gpt-6.1-terra", "gpt-transcribe", "gpt-realtime-2.1-mini"})
ENTRIES = frozenset({
    "snapshot/ledger.sqlite3", "snapshot/usage.jsonl", "snapshot/history.json", "snapshot/snapshot.json",
    "controls/approval.json", "controls/budget-policy.json", "controls/pilot-cohort.json",
})
_INFO = b"memy-staging-state-import-v1"
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_SERVICE = re.compile(r"srv-[a-z0-9]{10,64}\Z")


class ImportRejected(ValueError):
    """Only fixed classifications, never underlying data, leave the CLI."""


def _check(condition):
    if not condition:
        raise ImportRejected("STATE_IMPORT_REJECTED")


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()


def _key(value, salt):
    _check(isinstance(value, str))
    # Identical base64/length boundary to EncryptedSpeechCache; no raw key file.
    raw = base64.b64decode(value.encode("ascii"), altchars=b"-_", validate=True)
    _check(len(raw) == 32)
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=_INFO).derive(raw)


def _b64(value):
    return base64.urlsafe_b64encode(value).decode("ascii")


def _decode(value, maximum):
    _check(isinstance(value, str) and len(value) <= (maximum + 2) // 3 * 4 + 4)
    result = base64.b64decode(value.encode("ascii"), altchars=b"-_", validate=True)
    _check(len(result) <= maximum and _b64(result) == value)
    return result


def encrypt_bundle(entries: Mapping[str, bytes], speech_key: str, *, service_id=EXPECTED_SERVICE_ID) -> bytes:
    """No filesystem reads/writes. Fresh random salt/nonce, service-bound AAD."""
    _check(isinstance(entries, Mapping) and set(entries) == ENTRIES)
    _check(all(type(value) is bytes for value in entries.values()))
    _check(sum(map(len, entries.values())) <= MAX_BUNDLE_BYTES)
    _check(isinstance(service_id, str) and _SERVICE.fullmatch(service_id))
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in sorted(ENTRIES):
            item = zipfile.ZipInfo(name)
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(item, entries[name])
    payload = stream.getvalue()
    _check(0 < len(payload) <= MAX_BUNDLE_BYTES)
    salt, nonce = os.urandom(16), os.urandom(12)
    aad = _canonical({"version": 1, "service_id": service_id})
    ciphertext = AESGCM(_key(speech_key, salt)).encrypt(nonce, payload, aad)
    return _canonical({"version": 1, "service_id": service_id, "salt": _b64(salt),
                       "nonce": _b64(nonce), "ciphertext": _b64(ciphertext)}) + b"\n"


def _read_cipher(path, expected_sha256):
    _check(isinstance(expected_sha256, str) and _SHA.fullmatch(expected_sha256))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        _check(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_ENVELOPE_BYTES)
        data = source.read(MAX_ENVELOPE_BYTES + 1)
    _check(len(data) <= MAX_ENVELOPE_BYTES)
    _check(hmac.compare_digest(hashlib.sha256(data).hexdigest(), expected_sha256))
    return data


def _unpack(ciphertext, speech_key):
    envelope = json.loads(ciphertext.decode("utf-8"), object_pairs_hook=_unique_object)
    _check(type(envelope) is dict and set(envelope) == {"version", "service_id", "salt", "nonce", "ciphertext"})
    _check(type(envelope["version"]) is int and envelope["version"] == 1
           and envelope["service_id"] == EXPECTED_SERVICE_ID)
    salt, nonce = _decode(envelope["salt"], 16), _decode(envelope["nonce"], 12)
    _check(len(salt) == 16 and len(nonce) == 12)
    encrypted = _decode(envelope["ciphertext"], MAX_BUNDLE_BYTES + 16)
    aad = _canonical({"version": 1, "service_id": EXPECTED_SERVICE_ID})
    payload = AESGCM(_key(speech_key, salt)).decrypt(nonce, encrypted, aad)
    _check(0 < len(payload) <= MAX_BUNDLE_BYTES)
    entries = {}
    with zipfile.ZipFile(BytesIO(payload), "r") as archive:
        members = archive.infolist()
        _check(len(members) == len(ENTRIES) and {item.filename for item in members} == ENTRIES)
        _check(not archive.comment and sum(item.file_size for item in members) <= MAX_BUNDLE_BYTES)
        for item in members:
            mode = item.external_attr >> 16
            _check(item.orig_filename == item.filename and "\0" not in item.orig_filename
                   and not item.is_dir() and not item.flag_bits & 1
                   and stat.S_IFMT(mode) in {0, stat.S_IFREG}
                   and item.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                   and 0 <= item.file_size <= MAX_BUNDLE_BYTES)
            _check(item.filename not in entries)
            with archive.open(item) as source:
                value = source.read(MAX_BUNDLE_BYTES + 1)
            _check(len(value) == item.file_size and len(value) <= MAX_BUNDLE_BYTES)
            entries[item.filename] = value
    return entries


def _validate_runtime(directory, *, clock):
    backup = verify_backup(directory)
    history = verify_history(directory / "ledger.sqlite3", directory / "history.json")
    policy = load_policy(directory / "budget-policy.json")
    approval = _load_approval(directory / "approval.json")
    cohort = load_cohort(directory / "pilot-cohort.json")
    now = clock()
    _check(type(now) in {int, float} and math.isfinite(now) and now > 0
           and approval.expires_at > now and approval.budget_microusd <= MAX_WINDOW_MICROUSD
           and approval.allowed_models == MODELS and policy.external_hold_microusd == REMOTE_HOLD_MICROUSD)
    connection = ledger_connection(directory / "ledger.sqlite3")
    try:
        connection.execute("BEGIN")
        row = connection.execute("SELECT * FROM budget_policies WHERE policy_id=?", (policy.policy_id,)).fetchone()
        _check(row == (policy.policy_id, policy.digest, policy.namespace_digest, policy.accounting_core_digest))
        namespaces = {row[0] for row in connection.execute("SELECT subject_namespace_digest FROM budget_policies")}
        _check(namespaces == {policy.namespace_digest})
        chain = validate_ceiling_chain(connection, policy)
        _check(chain["maximum_ceiling_microusd"] == policy.global_budget_microusd)
        existing = connection.execute("SELECT digest FROM approvals WHERE approval_id=?", (approval.approval_id,)).fetchone()
        _check(existing is None or existing == (approval.digest,))
        totals = accounting(connection, policy, approval_id=approval.approval_id)
        remaining = approval.budget_microusd - totals["approval_accounted_microusd"]
        _check(remaining > 0 and totals["global_remaining_microusd"] >= remaining)
    finally:
        connection.close()
    return {"history_preserved": bool(history["history_preserved"]),
            "snapshot_verified": bool(backup["backup_valid"]), "reservations": history["reservations"],
            "approvals": history["approvals"], "cohort_members": len(cohort),
            "remote_hold_retained": True, "control_files_verified": True}


def _remove_owned_output(path, identity):
    try:
        info = path.lstat()
        if (info.st_dev, info.st_ino) == identity and stat.S_ISDIR(info.st_mode):
            shutil.rmtree(path)
    except OSError:
        pass


def import_bundle(cipher_file: Path, expected_sha256: str, output: Path, speech_key: str, *, clock=time.time):
    """Import only reviewed ciphertext into an absent target; no activation."""
    output = Path(output)
    _check(output.is_absolute() and ".." not in output.parts)
    private_directory(output.parent)
    _check(not os.path.lexists(output))
    entries = _unpack(_read_cipher(Path(cipher_file), expected_sha256), speech_key)
    with tempfile.TemporaryDirectory(prefix=".memy-import-", dir=output.parent) as temporary:
        workspace = Path(temporary)
        private_directory(workspace)
        snapshot = private_directory(workspace / "snapshot", create=True)
        for name in sorted(ENTRIES):
            if name.startswith("snapshot/"):
                write_new(snapshot / name.split("/", 1)[1], entries[name])
        verify_backup(snapshot)
        staged = workspace / "runtime"
        restore_new(snapshot, staged)
        for name in sorted(ENTRIES):
            if name.startswith("controls/"):
                write_new(staged / name.split("/", 1)[1], entries[name])
        result = _validate_runtime(staged, clock=clock)
        expected = {path.name: hashlib.sha256(read_private(path)).hexdigest() for path in staged.iterdir()}
        # Atomic new-directory reservation prevents a concurrent existing target
        # from being replaced. Stage and validate before any final output exists.
        output.mkdir(mode=0o700, exist_ok=False)
        info = output.lstat(); identity = (info.st_dev, info.st_ino)
        try:
            for name in sorted(expected):
                write_new(output / name, read_private(staged / name))
            actual = {path.name: hashlib.sha256(read_private(path)).hexdigest() for path in output.iterdir()}
            _check(actual == expected)
            _validate_runtime(output, clock=clock)
            fd = os.open(output, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except BaseException:
            _remove_owned_output(output, identity)
            raise
    return {"imported": True, **result, "all_seven_files_preserved": True,
            "history_rewritten": False, "providers_enabled": False, "spending_approved": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cipher-file", type=Path, default=Path("/etc/secrets/memy-state-import.enc"))
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output", type=Path, default=Path("/var/data/memy/runtime"))
    args = parser.parse_args(argv)
    try:
        _check(os.environ.get("RENDER_SERVICE_ID") == EXPECTED_SERVICE_ID)
        result = import_bundle(args.cipher_file, args.expected_sha256, args.output,
            os.environ.get("REAL_AI_SPEECH_ENCRYPTION_KEY", ""))
    except Exception:
        print(json.dumps({"imported": False, "code": "STATE_IMPORT_REJECTED",
                          "providers_enabled": False, "spending_approved": False}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
