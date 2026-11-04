"""Offline durable audio tests; no credentials, hosted data or provider calls."""

import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
import sqlite3
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.errors import APIError
from app.services.encrypted_speech_cache import EncryptedSpeechCache


@pytest.fixture
def store(tmp_path):
    directory = tmp_path / "private"
    directory.mkdir(mode=0o700)
    path, key, clock = directory / "speech.sqlite3", base64.urlsafe_b64encode(os.urandom(32)).decode(), [1000.0]
    return path, key, clock


def cache(store, **options):
    path, key, clock = store
    return EncryptedSpeechCache(path, key, clock=lambda: clock[0], **options)


def sound(marker=b"private fictional audio"):
    data = b"RIFF" + marker * 10
    return data, hashlib.sha256(data).hexdigest()


def assert_code(code, action):
    with pytest.raises(APIError) as result:
        action()
    assert result.value.code == code


def test_audio_survives_shutdown_and_restart_and_is_ciphertext_on_disk(store):
    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    first.close()
    assert cache(store).get(owner, speech, digest) == data
    assert b"private fictional audio" not in store[0].read_bytes()
    assert store[0].stat().st_mode & 0o777 == 0o600


def test_wrong_owner_and_wrong_digest_cannot_read_audio(store):
    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    assert_code("SPEECH_EXPIRED", lambda: first.get(uuid4(), speech, digest))
    assert_code("SPEECH_EXPIRED", lambda: first.get(owner, speech, "0" * 64))
    assert first.get(owner, speech, digest) == data


def test_expiry_is_absolute_not_extended_by_reads_or_restart(store):
    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    store[2][0] += 299
    assert first.get(owner, speech, digest) == data
    store[2][0] += 1
    assert_code("SPEECH_EXPIRED", lambda: cache(store).get(owner, speech, digest))
    with sqlite3.connect(store[0]) as connection:
        assert connection.execute("SELECT COUNT(*) FROM speech_audio").fetchone()[0] == 0


def test_explicit_metadata_expiry_can_be_shorter_than_maximum(store):
    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store, ttl=3600)
    first.put(owner, speech, data, digest, expires_at=store[2][0] + 20)
    store[2][0] += 20
    assert_code("SPEECH_EXPIRED", lambda: first.get(owner, speech, digest))


@pytest.mark.parametrize("field,value", [
    ("expires", 2000.0), ("nonce", b"0" * 12), ("ciphertext", b"1" * 240),
])
def test_ciphertext_and_authenticated_metadata_tampering_fail_closed(store, field, value):
    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    with sqlite3.connect(store[0]) as connection:
        connection.execute(f"UPDATE speech_audio SET {field}=?", (value,))
    assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: first.get(owner, speech, digest))


def test_copying_encrypted_reply_to_another_owner_does_not_grant_access(store):
    owner, other, speech = uuid4(), uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    with sqlite3.connect(store[0]) as connection:
        connection.execute("UPDATE speech_audio SET owner=?", (str(other),))
    assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: first.get(other, speech, digest))


def test_wrong_key_fails_closed_without_deleting_prepared_audio(store):
    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    different = EncryptedSpeechCache(store[0], base64.urlsafe_b64encode(os.urandom(32)).decode(), clock=lambda: store[2][0])
    assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: different.get(owner, speech, digest))
    assert first.get(owner, speech, digest) == data


def test_quota_evicts_oldest_without_exceeding_total_and_other_owner_cleanup_is_scoped(store):
    data, digest = sound()
    first = cache(store, max_bytes=len(data) * 2)
    owner, other, a, b, c = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()
    first.put(owner, a, data, digest)
    store[2][0] += 1
    first.put(other, b, data, digest)
    store[2][0] += 1
    first.put(owner, c, data, digest)
    assert_code("SPEECH_EXPIRED", lambda: first.get(owner, a, digest))
    assert first.purge_owner(owner) == 1
    assert_code("SPEECH_EXPIRED", lambda: first.get(owner, c, digest))
    assert first.get(other, b, digest) == data


def test_expired_cleanup_is_explicit_and_does_not_delete_unexpired_audio(store):
    owner, a, b = uuid4(), uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, a, data, digest)
    store[2][0] += 100
    first.put(owner, b, data, digest)
    store[2][0] += 200
    assert first.purge_expired() == 1
    assert first.get(owner, b, digest) == data


@pytest.mark.parametrize("key", ["", "not-a-key", base64.urlsafe_b64encode(b"short").decode()])
def test_invalid_encryption_key_does_not_start_or_print_key(store, key):
    assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: EncryptedSpeechCache(store[0], key))


@pytest.mark.parametrize("condition", ["symlink", "hardlink", "world-readable", "shared-directory", "linked-directory", "replacement"])
def test_untrusted_paths_and_replaced_database_fail_closed(store, tmp_path, condition):
    first = cache(store)
    path = store[0]
    if condition == "symlink":
        original = path.with_suffix(".original")
        path.rename(original)
        path.symlink_to(original)
    elif condition == "hardlink":
        os.link(path, path.with_suffix(".link"))
    elif condition == "world-readable":
        path.chmod(0o644)
    elif condition == "shared-directory":
        path.parent.chmod(0o755)
    elif condition == "linked-directory":
        alias = tmp_path / "linked"
        alias.symlink_to(path.parent, target_is_directory=True)
        assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: EncryptedSpeechCache(alias / path.name, store[1]))
        return
    else:
        path.rename(path.with_suffix(".original"))
        path.touch(mode=0o600)
    assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: first.get(uuid4(), uuid4(), "0" * 64))


def test_concurrent_writes_remain_bounded_and_owner_scoped(store):
    data, digest = sound()
    first = cache(store, max_bytes=len(data) * 5)
    rows = [(uuid4(), uuid4()) for _ in range(10)]
    with ThreadPoolExecutor(max_workers=5) as workers:
        list(workers.map(lambda row: first.put(*row, data, digest), rows))
    with sqlite3.connect(store[0]) as connection:
        assert connection.execute("SELECT COUNT(*),SUM(size) FROM speech_audio").fetchone() == (5, len(data) * 5)


def test_foreign_database_is_not_overwritten(store):
    with sqlite3.connect(store[0]) as connection:
        connection.execute("CREATE TABLE existing_private_data (value TEXT)")
    store[0].chmod(0o600)
    assert_code("SPEECH_STORAGE_UNAVAILABLE", lambda: cache(store))
    with sqlite3.connect(store[0]) as connection:
        assert connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == [("existing_private_data",)]


def test_cleanup_script_default_inventory_has_no_deletion_or_sensitive_output(store, monkeypatch, capsys):
    from pydantic import SecretStr
    from scripts import cleanup_speech_cache

    owner, speech = uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    monkeypatch.setattr(cleanup_speech_cache, "Settings", lambda: SimpleNamespace(
        real_ai_speech_storage_path=store[0], real_ai_speech_encryption_key=SecretStr(store[1]),
        real_ai_speech_retention_seconds=300, real_ai_speech_max_bytes=32_000_000))
    assert cleanup_speech_cache.main([]) == 0
    output = capsys.readouterr().out
    assert '"deleted_count": 0' in output
    assert all(sensitive not in output for sensitive in (store[1], str(owner), str(speech), "private fictional audio"))
    assert first.get(owner, speech, digest) == data


def test_cleanup_script_requires_scope_for_apply_and_preserves_other_owner(store, monkeypatch, capsys):
    from pydantic import SecretStr
    from scripts import cleanup_speech_cache

    owner, other, speech, other_speech = uuid4(), uuid4(), uuid4(), uuid4()
    data, digest = sound()
    first = cache(store)
    first.put(owner, speech, data, digest)
    first.put(other, other_speech, data, digest)
    monkeypatch.setattr(cleanup_speech_cache, "Settings", lambda: SimpleNamespace(
        real_ai_speech_storage_path=store[0], real_ai_speech_encryption_key=SecretStr(store[1]),
        real_ai_speech_retention_seconds=300, real_ai_speech_max_bytes=32_000_000))
    with pytest.raises(SystemExit):
        cleanup_speech_cache.main(["--apply"])
    assert cleanup_speech_cache.main(["--owner", str(owner), "--apply"]) == 0
    output = capsys.readouterr().out
    assert '"deleted_count": 1' in output
    assert_code("SPEECH_EXPIRED", lambda: first.get(owner, speech, digest))
    assert first.get(other, other_speech, digest) == data
