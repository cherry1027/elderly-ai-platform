"""Export the mobile contract without starting a server or using the network.

Importing the normal application validates its local/environment settings.
Valid configuration is required, but no credentials are emitted in the schema.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402

SNAPSHOT = BACKEND_DIR.parent / "docs" / "openapi.json"


def render_specification() -> str:
    # The normal entrypoint validates its configuration at import. No ASGI
    # lifespan runs, so no Auth, Data API or provider request occurs.
    from app.main import create_app

    settings = Settings(
        _env_file=None,
        supabase_url=None,
        supabase_publishable_key=None,
        conversation_mode="disabled",
        story_generation_mode="disabled",
    )
    return json.dumps(create_app(settings).openapi(), ensure_ascii=False,
                      indent=2, sort_keys=True) + "\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="Fail if the checked-in snapshot differs; do not write.")
    args = parser.parse_args(argv)
    try:
        specification = render_specification()
    except Exception:
        # A malformed local setting must fail closed without printing values,
        # environment dumps or library exception bodies.
        print("Cannot export OpenAPI: check application configuration and dependencies.", file=sys.stderr)
        return 2
    if args.check:
        if not SNAPSHOT.is_file() or SNAPSHOT.read_text(encoding="utf-8") != specification:
            print("OpenAPI snapshot differs; run scripts/export_openapi.py.", file=sys.stderr)
            return 1
        print("OpenAPI snapshot matches the current application.")
        return 0
    SNAPSHOT.write_text(specification, encoding="utf-8")
    print("Exported docs/openapi.json offline (no credential output or network requests).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
