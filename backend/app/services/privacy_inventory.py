"""Read-only, content-free counts visible to one authenticated user's RLS.

Not an erasure executor or proof of complete deletion. Hidden/deleted rows,
private internal ledgers, storage blobs, backups and external processors need a
separate administrator-reviewed inventory. Never use a service-role credential.
"""

import re

import httpx

from app.core.config import Settings
from app.core.errors import APIError, invalid_token
from app.services.auth import AuthenticatedUser

# Closed allowlist, not interpolated caller input. No original story fields are
# requested, and HEAD/limit=0 ensures this tool receives no narrative row bodies.
RELATIONS = (
    ("profiles", "id", "user_id"),
    ("user_settings", "user_id", "user_id"),
    ("books", "id", "user_id"),
    ("story_projects", "id", "user_id"),
    ("conversation_sessions", "id", None),
    ("conversation_messages", "id", None),
    ("audio_transcripts", "transcript_id", None),
    ("memory_facts", "id", None),
    ("memory_clarifications", "id", None),
    ("story_drafts", "id", None),
    ("draft_source_memories", "id", None),
    ("story_verification_results", "id", None),
    ("story_edit_history", "id", None),
    ("story_exports", "id", None),
)

# Real-v2 shares account/project/session metadata with v1, but stores its own
# immutable originals and reviewed results. Internal operation/claim records
# intentionally have no authenticated SELECT grant and must not be probed here.
REAL_V2_RELATIONS = RELATIONS[:5] + (
    ("real_text_inputs", "input_id", "owner_id"),
    ("real_transcripts", "transcript_id", "owner_id"),
    ("real_conversation_messages", "id", "owner_id"),
    ("real_memories", "id", "owner_id"),
    ("real_memory_clarifications", "id", "owner_id"),
    ("real_memory_revisions", "id", "owner_id"),
    ("real_story_drafts", "draft_id", "owner_id"),
    ("real_story_edits", "id", "owner_id"),
    ("real_speech", "speech_id", "owner_id"),
    ("real_story_exports", "export_id", "owner_id"),
)
CONTRACT_RELATIONS = {
    "v1": RELATIONS,
    "real-v2": REAL_V2_RELATIONS,
    "all": RELATIONS + REAL_V2_RELATIONS[5:],
}


def unavailable() -> APIError:
    return APIError(503, "PRIVACY_INVENTORY_UNAVAILABLE", "The privacy inventory could not be verified.")


async def inventory_visible_data(settings: Settings, client: httpx.AsyncClient,
                                 user: AuthenticatedUser, *, contract: str = "v1") -> dict:
    if contract not in CONTRACT_RELATIONS or not settings.supabase_configured:
        raise unavailable()
    origin = str(settings.supabase_url).rstrip("/")
    headers = {
        "apikey": settings.supabase_publishable_key.get_secret_value(),
        "Authorization": "Bearer " + user.access_token.get_secret_value(),
        "Prefer": "count=exact",
    }
    counts = {}
    for relation, column, owner_column in CONTRACT_RELATIONS[contract]:
        params = {"select": column, "limit": "0"}
        if owner_column:
            params[owner_column] = "eq." + str(user.id)
        try:
            response = await client.head(f"{origin}/rest/v1/{relation}", params=params,
                                         headers=headers, follow_redirects=False)
        except httpx.HTTPError:
            raise unavailable() from None
        if response.status_code == 401:
            raise invalid_token()
        if response.status_code not in (200, 206):
            raise unavailable()
        match = re.fullmatch(r"(?:\*|[0-9]+-[0-9]+)/([0-9]{1,19})", response.headers.get("Content-Range", ""))
        if not match or int(match[1]) > 9_223_372_036_854_775_807:
            raise unavailable()
        counts[relation] = int(match[1])
    excluded = ["RLS-hidden and inaccessible rows", "internal ledgers", "storage objects",
                "provider copies", "backups", "logs", "downloaded device files"]
    if contract != "v1":
        excluded.append("real_ai_operations: privileged operation and claim records")
    return {
        "mode": "read_only_visible_counts", "deleted": False,
        "contract": contract,
        "counts": counts, "counts_are_additive": False,
        "complete_erasure_inventory": False,
        "excluded": excluded,
        "deletion_status": "Requires verified identity, retention/legal review and separate explicit approval.",
    }
