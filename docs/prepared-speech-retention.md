# Prepared spoken replies: retention and recovery

The existing API stores speech metadata in owner-restricted Supabase rows. Audio
reads verify current metadata ownership before reading private audio. Reads never
activate AI or synthesize a replacement automatically, including when spending
approval has expired. `SPEECH_EXPIRED` means an explicit new paid request would
be needed; `SPEECH_STORAGE_UNAVAILABLE` means the existing storage needs recovery.

## Two explicit storage choices

- Default: `REAL_AI_SPEECH_STORAGE_PATH` is unset. Audio remains in bounded RAM,
  expires after 300 seconds, and disappears on server shutdown. This preserves
  existing development behavior.
- Staging option: set `REAL_AI_SPEECH_STORAGE_PATH` to an absolute SQLite file on
  a persistent private volume and provide `REAL_AI_SPEECH_ENCRYPTION_KEY` through
  the server's secret store. Audio is AES-256-GCM encrypted before SQLite writes
  it. The key must be the URL-safe base64 representation of 32 random bytes and
  must be backed up separately from the encrypted database. Never embed it in
  mobile configuration, a review ZIP, a chat message or logs.

The directory must already exist with owner-only permissions (0700); database
files use 0600. Symlink/hardlink/shared paths and replaced files fail closed.
One persistent disk and one service instance are supported. Do not share this
SQLite cache over a network filesystem.

`REAL_AI_SPEECH_RETENTION_SECONDS` is configurable between **300 and 3600 seconds**.
The default stays 300. The current immutable Supabase metadata permits at most
one hour; extending beyond that needs a separate reviewed contract and retention
decision. Increasing this setting does not extend already-created metadata.

`REAL_AI_SPEECH_MAX_BYTES` defaults to 32,000,000. A single reply is limited to
8,000,000 bytes. The oldest replies can be evicted when the bounded cache is full,
so retention is a maximum rather than a guarantee. Repeated owned GET requests
and a normal restart can replay unexpired retained audio without another paid
generation. Server shutdown closes the durable cache without deleting it.

AES-GCM authenticates the owner, speech ID, digest and expiry along with the audio.
Changing any of them makes decryption fail. A changed/lost key cannot recover old
audio; changing the key is not a safe way to clear errors or regenerate speech.

## Privacy cleanup

Expired audio is inaccessible immediately and its ciphertext is removed on a
subsequent put/read or an explicit expired purge. An operator should schedule an
expired purge on the persistent host to remove dormant expired ciphertext too.
Commands use the private server environment and print numeric counts only:

```bash
python scripts/cleanup_speech_cache.py
python scripts/cleanup_speech_cache.py --expired
# After reviewing the inventory:
python scripts/cleanup_speech_cache.py --expired --apply
```

For an approved account-erasure request, first inspect an owner's audio counts,
then explicitly remove only that owner's encrypted audio:

```bash
python scripts/cleanup_speech_cache.py --owner <approved-owner-uuid>
python scripts/cleanup_speech_cache.py --owner <approved-owner-uuid> --apply
```

This does not delete Supabase metadata, transcripts, stories or backups. Those
need the separately approved erasure workflow. Backups may retain ciphertext
until their own retention expiry. No existing hosted or local user data is
deleted merely by deploying this implementation or running inventory mode.

This change provides a restart-safe replay mechanism; the app still needs its
frontend voice recovery fix and actual-device playback acceptance.
