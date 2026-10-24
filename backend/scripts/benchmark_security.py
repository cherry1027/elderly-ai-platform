"""Reproducible offline timing smoke check, NOT hosted capacity acceptance.

Auth and PostgreSQL use explicit in-process HTTP doubles. The real PDF renderer
uses only fixed fictional text. No credentials transmitted, provider calls or
files written. Invalid ambient startup configuration can block the check.
"""

import argparse
import asyncio
import json
import math
from pathlib import Path
import statistics
import sys
import time

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.services.pdf_export import PdfRenderer  # noqa: E402

OWNER = "11111111-1111-4111-8111-111111111111"
PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


def summary(values):
    ordered = sorted(values)
    return {"samples": len(values), "p50_ms": round(statistics.median(ordered), 3),
            "p95_ms": round(ordered[math.ceil(len(ordered) * .95) - 1], 3),
            "max_ms": round(ordered[-1], 3)}


async def run(iterations=40, concurrency=4):
    # app.main validates its normal local configuration at import. Keep that
    # import inside main's sanitized failure boundary; the measured app below
    # uses explicit synthetic credentials and closed provider modes only.
    from app.main import create_app

    calls = 0

    def upstream(request):
        nonlocal calls
        calls += 1
        if request.url.path == "/auth/v1/user":
            return httpx.Response(200, json={"id": OWNER})
        if request.url.path == "/rest/v1/story_projects":
            return httpx.Response(200, json=[{
                "id": PROJECT, "user_id": OWNER, "title": "Fictional benchmark",
                "description": None, "language": "en", "status": "draft",
                "created_at": "2026-10-23T10:00:00Z", "updated_at": "2026-10-23T10:00:00Z",
            }])
        raise RuntimeError("Unexpected offline request")

    app = create_app(Settings(_env_file=None, supabase_url="https://offline.example.supabase.co",
                             supabase_publishable_key="synthetic-unused-publishable",
                             api_requests_per_minute=600, ai_provider_mode="disabled", openai_api_key=None,
                             conversation_mode="disabled", story_generation_mode="disabled"),
                     transport=httpx.MockTransport(upstream))
    metrics = {}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://offline", trust_env=False) as client:
            for path, label in [("/health", "liveness"), ("/api/v1/story-projects", "authenticated_project_list")]:
                slots = asyncio.Semaphore(concurrency)

                async def measure():
                    async with slots:
                        start = time.perf_counter()
                        response = await client.get(path, headers={"Authorization": "Bearer fictional-token"})
                        if response.status_code != 200:
                            raise RuntimeError("Offline response failed")
                        return (time.perf_counter() - start) * 1000

                metrics[label] = summary(await asyncio.gather(*(measure() for _ in range(iterations))))
    renderer = PdfRenderer()
    pdf_values = []
    pdf_sizes = []
    for _ in range(3):
        start = time.perf_counter()
        result = renderer.render(title="Fictional benchmark", content=("I grew up in Malmö. " * 800).strip(),
                                 language="en", draft_version=1, draft_revision=1,
                                 include_title_page=True, include_page_numbers=True)
        pdf_values.append((time.perf_counter() - start) * 1000)
        pdf_sizes.append(len(result.data))
    metrics["in_memory_pdf_15999_characters"] = {**summary(pdf_values), "max_bytes": max(pdf_sizes)}
    return {"scope": "offline_ASGI_mock_Auth_DataAPI_and_real_fictional_PDF",
            "network_calls": 0, "paid_calls": 0, "mock_upstream_calls": calls,
            "concurrency": concurrency, "metrics": metrics,
            "hosted_capacity_verified": False, "device_acceptance_verified": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=40)
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args(argv)
    if not 1 <= args.iterations <= 200 or not 1 <= args.concurrency <= 16:
        parser.error("Use 1–200 iterations and 1–16 concurrent requests.")
    try:
        result = asyncio.run(run(args.iterations, args.concurrency))
    except Exception:
        print("Offline timing check failed; details suppressed.", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
