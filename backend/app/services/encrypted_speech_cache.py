"""Bounded, owner-scoped encrypted speech retention on one private POSIX disk.

Audio is encrypted before SQLite sees it. The key is supplied independently from
server configuration and is never written to this database. Every audio read
still requires the API's current owned Supabase metadata; this store never grants
access by itself. TTL is deliberately bounded by the existing one-hour SQL
contract. Missing/expired audio never generates another paid reply implicitly.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.errors import APIError
from app.services.ai_controls import _private_file, _private_parent


_APPLICATION_ID = 0x4D535043
_SCHEMA_VERSION = 1
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")
_MAX_AUDIO_BYTES = 8_000_000
_MAX_ITEMS = 512


def _unavailable():
    return APIError(503, "SPEECH_STORAGE_UNAVAILABLE", "Saved spoken audio is temporarily unavailable.")


def _expired():
    return APIError(410, "SPEECH_EXPIRED", "Spoken reply expired. Request a new reply explicitly.")


def _aad(owner, speech_id, digest, expires):
    return json.dumps([str(owner), str(speech_id), digest, expires],
                      separators=(",", ":"), allow_nan=False).encode("ascii")


class EncryptedSpeechCache:
    """Restart-safe AES-256-GCM speech cache; not a public file or signed URL.

    One database belongs to one host and key. Use one persistent encrypted
    volume for staging and protect the key separately. Expiry is enforced on
    every read; expired ciphertext is removed on the next store operation or
    explicit purge. Backups can retain ciphertext until their own expiry.
    """

    def __init__(self, path: Path, key: str, *, ttl=300, max_bytes=32_000_000,
                 clock=time.time):
        self.path, self.ttl, self.max_bytes, self.clock = Path(path), ttl, max_bytes, clock
        self._identity = None
        try:
            if (type(ttl) is not int or not 300 <= ttl <= 3600
                or type(max_bytes) is not int or not 44 <= max_bytes <= 256_000_000
                or not isinstance(key, str)):
                raise ValueError
            decoded = base64.b64decode(key.encode("ascii"), altchars=b"-_", validate=True)
            if len(decoded) != 32:
                raise ValueError
            self._cipher = AESGCM(decoded)
            connection = self._connect()
            try:
                with connection:
                    self._schema(connection)
            finally:
                connection.close()
        except (OSError, ValueError, UnicodeError, TypeError, sqlite3.Error):
            raise _unavailable() from None

    def _now(self):
        now = self.clock()
        if type(now) not in {float, int} or not math.isfinite(now) or now < 0:
            raise ValueError
        return float(now)

    def _check_file(self, info):
        _private_file(info)
        if info.st_size > self.max_bytes * 3 + 2_000_000:
            raise ValueError
        identity = (info.st_dev, info.st_ino)
        if self._identity is not None and self._identity != identity:
            raise ValueError
        self._identity = identity

    def _connect(self):
        _private_parent(self.path)
        for suffix in ("-journal", "-wal", "-shm"):
            sidecar = self.path.with_name(self.path.name + suffix)
            try:
                _private_file(sidecar.lstat())
            except FileNotFoundError:
                pass
        try:
            descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            descriptor = os.open(self.path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            self._check_file(os.fstat(descriptor))
        finally:
            os.close(descriptor)
        connection = sqlite3.connect(f"{self.path.as_uri()}?mode=rw", uri=True, timeout=5)
        try:
            self._check_file(self.path.lstat())
            connection.execute("PRAGMA journal_mode=DELETE")
            connection.execute("PRAGMA secure_delete=ON")
            connection.execute("PRAGMA synchronous=FULL")
            return connection
        except BaseException:
            connection.close()
            raise

    def _schema(self, connection):
        app_id = connection.execute("PRAGMA application_id").fetchone()[0]
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        if (app_id, version) == (0, 0) and not tables:
            connection.execute(f"PRAGMA application_id={_APPLICATION_ID}")
            connection.execute(f"PRAGMA user_version={_SCHEMA_VERSION}")
            connection.execute("""CREATE TABLE speech_audio (
                owner TEXT NOT NULL, speech_id TEXT NOT NULL, digest TEXT NOT NULL,
                expires REAL NOT NULL, created REAL NOT NULL, size INTEGER NOT NULL,
                nonce BLOB NOT NULL, ciphertext BLOB NOT NULL,
                PRIMARY KEY(owner,speech_id))""")
        elif (app_id, version) != (_APPLICATION_ID, _SCHEMA_VERSION):
            raise ValueError
        columns = connection.execute("PRAGMA table_info(speech_audio)").fetchall()
        if [row[1] for row in columns] != ["owner", "speech_id", "digest", "expires", "created", "size", "nonce", "ciphertext"]:
            raise ValueError

    @staticmethod
    def _ids(owner, speech_id):
        if not isinstance(owner, UUID) or not isinstance(speech_id, UUID):
            raise ValueError

    def put(self, owner: UUID, speech_id: UUID, data: bytes, digest: str, *, expires_at=None):
        try:
            self._ids(owner, speech_id)
            now = self._now()
            expires = now + self.ttl if expires_at is None else expires_at
            if (type(data) is not bytes or not 44 <= len(data) <= min(_MAX_AUDIO_BYTES, self.max_bytes)
                or not isinstance(digest, str) or not _DIGEST.fullmatch(digest)
                or hashlib.sha256(data).hexdigest() != digest
                or type(expires) not in {int, float} or not math.isfinite(expires)
                or not now < expires <= now + self.ttl):
                raise ValueError
            expires = float(expires)
            nonce = os.urandom(12)
            ciphertext = self._cipher.encrypt(nonce, data, _aad(owner, speech_id, digest, expires))
            connection = self._connect()
            try:
                with connection:
                    connection.execute("BEGIN IMMEDIATE")
                    self._schema(connection)
                    connection.execute("DELETE FROM speech_audio WHERE expires<=?", (now,))
                    connection.execute("DELETE FROM speech_audio WHERE owner=? AND speech_id=?", (str(owner), str(speech_id)))
                    total, count = connection.execute("SELECT COALESCE(SUM(size),0), COUNT(*) FROM speech_audio").fetchone()
                    while total + len(data) > self.max_bytes or count >= _MAX_ITEMS:
                        oldest = connection.execute("SELECT owner,speech_id,size FROM speech_audio ORDER BY created,owner,speech_id LIMIT 1").fetchone()
                        if oldest is None:
                            raise ValueError
                        connection.execute("DELETE FROM speech_audio WHERE owner=? AND speech_id=?", oldest[:2])
                        total, count = total - oldest[2], count - 1
                    connection.execute("INSERT INTO speech_audio VALUES (?,?,?,?,?,?,?,?)",
                                       (str(owner), str(speech_id), digest, expires, now, len(data), nonce, ciphertext))
            finally:
                connection.close()
        except (OSError, ValueError, TypeError, OverflowError, sqlite3.Error):
            raise _unavailable() from None

    def get(self, owner: UUID, speech_id: UUID, digest: str) -> bytes:
        try:
            self._ids(owner, speech_id)
            now = self._now()
            connection = self._connect()
            try:
                with connection:
                    self._schema(connection)
                    row = connection.execute("SELECT digest,expires,size,nonce,ciphertext FROM speech_audio WHERE owner=? AND speech_id=?",
                                             (str(owner), str(speech_id))).fetchone()
                    if row is not None and row[1] <= now:
                        connection.execute("DELETE FROM speech_audio WHERE owner=? AND speech_id=?", (str(owner), str(speech_id)))
                        row = None
            finally:
                connection.close()
            if row is None or row[0] != digest:
                raise _expired()
            stored_digest, expires, size, nonce, ciphertext = row
            if (type(expires) not in {int, float} or not math.isfinite(expires)
                or type(size) is not int or not 44 <= size <= min(_MAX_AUDIO_BYTES, self.max_bytes)
                or not isinstance(stored_digest, str) or not _DIGEST.fullmatch(stored_digest)
                or type(nonce) is not bytes or len(nonce) != 12
                or type(ciphertext) is not bytes or len(ciphertext) != size + 16):
                raise ValueError
            data = self._cipher.decrypt(nonce, ciphertext, _aad(owner, speech_id, stored_digest, expires))
            if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
                raise ValueError
            return data
        except (OSError, ValueError, TypeError, OverflowError, sqlite3.Error, InvalidTag):
            raise _unavailable() from None

    def purge_expired(self):
        return self._delete("expires<=?", (self._now(),))

    def purge_owner(self, owner: UUID):
        if not isinstance(owner, UUID):
            raise _unavailable()
        return self._delete("owner=?", (str(owner),))

    def inventory(self, owner: UUID | None = None):
        """Numeric operator inventory; never return content, keys or IDs."""
        try:
            if owner is not None and not isinstance(owner, UUID):
                raise ValueError
            connection = self._connect()
            try:
                self._schema(connection)
                condition, parameters = ("WHERE owner=?", (str(owner),)) if owner is not None else ("", ())
                count, size, expired = connection.execute(
                    f"SELECT COUNT(*),COALESCE(SUM(size),0),COALESCE(SUM(expires<=?),0) FROM speech_audio {condition}",
                    (self._now(), *parameters)).fetchone()
                return {"audio_count": count, "plaintext_bytes": size, "expired_count": expired}
            finally:
                connection.close()
        except (OSError, ValueError, TypeError, sqlite3.Error):
            raise _unavailable() from None

    def _delete(self, condition, parameters):
        try:
            connection = self._connect()
            try:
                with connection:
                    self._schema(connection)
                    cursor = connection.execute(f"DELETE FROM speech_audio WHERE {condition}", parameters)
                    return cursor.rowcount
            finally:
                connection.close()
        except (OSError, ValueError, TypeError, sqlite3.Error):
            raise _unavailable() from None

    def close(self):
        """No open handles or plaintext buffers remain between calls.

        Shutdown intentionally preserves unexpired encrypted replies. Privacy
        cleanup uses purge_owner; a restart must not masquerade as erasure.
        """

    def clear(self):
        """Compatibility shutdown hook; does not delete retained ciphertext."""
        self.close()
