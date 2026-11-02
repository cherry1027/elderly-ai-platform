"""Owned saved PDFs stay free when AI is disabled or its test budget is spent.

All Auth/database traffic uses MockTransport; ReportLab still renders real PDFs.
No provider credentials, hosted data or live requests are used.
"""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import json
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
from pypdf import PdfReader
import pytest

from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from tests.test_real_ai_read_performance import context, draft_row
from tests.test_real_ai_resources import OWNER, PROJECT, PUBLISHABLE, STAMP, USER_TOKEN, project_row


class SavedPdfScenario:
    def __init__(self, language):
        self.language = language
        self.draft = draft_row(3)
        self.draft['language'] = language
        self.export_id = str(uuid4())
        self.saved = None
        self.paths = []
        self.foreign = False

    def handle(self, request):
        path = request.url.path
        self.paths.append(path)
        assert request.headers['apikey'] == PUBLISHABLE
        assert request.headers['authorization'] == f'Bearer {USER_TOKEN}'
        if path.endswith('/auth/v1/user'):
            return httpx.Response(200, json={'id': str(OWNER)})
        if path.endswith('/story_projects'):
            assert request.url.params['user_id'] == f'eq.{OWNER}'
            return httpx.Response(200, json=[] if self.foreign else [{**project_row(), 'language': self.language}])
        if path.endswith('/real_story_drafts'):
            assert request.url.params['owner_id'] == f'eq.{OWNER}'
            return httpx.Response(200, json=[] if self.foreign else [deepcopy(self.draft)])
        if path.endswith('/rpc/get_real_story_context'):
            return httpx.Response(200, json={**context(), 'language': self.language})
        if path.endswith('/rpc/record_real_story_export'):
            body = json.loads(request.content)
            assert body['p_draft_id'] == self.draft['draft_id']
            assert body['p_expected_revision'] == self.draft['revision']
            self.saved = {'export': {
                'export_id': self.export_id, 'project_id': str(PROJECT), 'draft_id': self.draft['draft_id'],
                'draft_version': self.draft['version'], 'draft_revision': self.draft['revision'],
                'language': self.language, 'title': body['p_project_title'], 'format': 'pdf',
                'include_title_page': body['p_include_title_page'], 'include_page_numbers': body['p_include_page_numbers'],
                'renderer_version': body['p_renderer_version'], 'filename': body['p_filename'],
                'content_sha256': sha256(self.draft['content'].encode()).hexdigest(),
                'page_count': body['p_page_count'], 'byte_size': body['p_byte_size'], 'created_at': STAMP,
            }, 'content': self.draft['content']}
            return httpx.Response(200, json=self.saved['export'])
        if path.endswith('/rpc/get_real_story_export'):
            assert json.loads(request.content) == {'p_export_id': self.export_id}
            if self.foreign:
                return httpx.Response(404, json={'code': 'P0002', 'message': 'Synthetic inaccessible export'})
            assert self.saved is not None
            return httpx.Response(200, json=self.saved)
        raise AssertionError(f'Unexpected offline route: {path}')


def app_with_closed_ai(tmp_path, scenario, gate):
    private = tmp_path/'private'
    private.mkdir(mode=0o700)
    approval = private/'approval.json'
    ledger = private/'usage.sqlite3'
    approval.write_text(json.dumps({
        'approval_id': 'offline-pdf-exhausted', 'approved_by': 'offline-test',
        'expires_at': (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),
        'max_calls': 1, 'max_calls_per_minute': 1, 'budget_microusd': 1000,
        'reserve_per_call_microusd': 1000, 'allowed_models': ['offline-model'],
    }))
    approval.chmod(0o600)
    settings = Settings(_env_file=None, supabase_url='https://offline-fixture.supabase.co',
        supabase_publishable_key=PUBLISHABLE, openai_api_key=None, supabase_secret_key=None,
        real_ai_enabled=False, ai_provider_mode='disabled', conversation_mode='disabled',
        story_generation_mode='disabled', live_ai_approval_path=approval, ai_usage_ledger_path=ledger)
    app = create_app(settings, transport=httpx.MockTransport(scenario.handle))
    runtime = app.state.real_ai
    if gate == 'exhausted':
        runtime.governor.reserve('conversation', 'offline-model')
        with pytest.raises(APIError) as spent:
            runtime.governor.reserve('conversation', 'offline-model')
        assert spent.value.code == 'AI_USAGE_LIMIT'
    before = ledger.read_bytes() if ledger.exists() else None
    checks = []

    def closed(*_args, **_kwargs):
        checks.append('require')
        raise APIError(503 if gate == 'disabled' else 429,
                       'LIVE_AI_DISABLED' if gate == 'disabled' else 'AI_USAGE_LIMIT', 'Synthetic closed AI.')

    def forbidden(*_args, **_kwargs):
        pytest.fail('A saved PDF must never reserve budget or contact a provider')

    runtime.require = closed
    runtime.governor.reserve = forbidden
    runtime.governor.check_approval = forbidden
    runtime.provider = type('ForbiddenProvider', (), {
        name: staticmethod(forbidden) for name in ('write', 'respond', 'transcribe', 'synthesize')
    })()
    return app, checks, ledger, before


@pytest.mark.parametrize('gate', ['disabled', 'exhausted'])
@pytest.mark.parametrize('language', ['en', 'sv'])
def test_export_and_historical_download_work_without_ai_or_new_reservations(tmp_path, gate, language):
    scenario = SavedPdfScenario(language)
    app, checks, ledger, before = app_with_closed_ai(tmp_path, scenario, gate)
    headers = {'Authorization': f'Bearer {USER_TOKEN}'}
    with TestClient(app) as client:
        created = client.post(f"/api/v2/story-drafts/{scenario.draft['draft_id']}/export",
            json={'expected_revision': 1}, headers=headers)
        assert created.status_code == 201, created.text
        for _ in range(2):
            downloaded = client.get(f'/api/v2/story-exports/{scenario.export_id}/download', headers=headers)
            assert downloaded.status_code == 200, downloaded.text
            assert downloaded.content == created.content
            assert downloaded.headers['content-type'] == 'application/pdf'
            assert downloaded.headers['cache-control'] == 'private, no-store'
            assert 'Malmö' in ''.join(page.extract_text() for page in PdfReader(BytesIO(downloaded.content)).pages)
    assert checks == []
    assert (ledger.read_bytes() if ledger.exists() else None) == before
    assert sum(path.endswith('/rpc/record_real_story_export') for path in scenario.paths) == 1
    assert sum(path.endswith('/rpc/get_real_story_export') for path in scenario.paths) == 2


@pytest.mark.parametrize('kind', ['draft', 'saved-export'])
def test_closed_ai_does_not_bypass_pdf_ownership(tmp_path, kind):
    scenario = SavedPdfScenario('en')
    scenario.foreign = True
    app, checks, ledger, before = app_with_closed_ai(tmp_path, scenario, 'exhausted')
    with TestClient(app) as client:
        headers = {'Authorization': f'Bearer {USER_TOKEN}'}
        if kind == 'draft':
            response = client.post(f"/api/v2/story-drafts/{scenario.draft['draft_id']}/export",
                json={'expected_revision': 1}, headers=headers)
        else:
            response = client.get(f'/api/v2/story-exports/{scenario.export_id}/download', headers=headers)
    assert response.status_code == 404
    assert not response.content.startswith(b'%PDF-') and checks == []
    assert (ledger.read_bytes() if ledger.exists() else None) == before
    assert not any(path.endswith('/rpc/record_real_story_export') for path in scenario.paths)


def test_pdf_export_still_rejects_a_stale_revision_with_closed_ai(tmp_path):
    scenario = SavedPdfScenario('en')
    app, checks, ledger, before = app_with_closed_ai(tmp_path, scenario, 'exhausted')
    with TestClient(app) as client:
        response = client.post(f"/api/v2/story-drafts/{scenario.draft['draft_id']}/export",
            json={'expected_revision': 2}, headers={'Authorization': f'Bearer {USER_TOKEN}'})
    assert response.status_code == 409 and response.json()['error']['code'] == 'DRAFT_REVISION_CONFLICT'
    assert checks == [] and ledger.read_bytes() == before
    assert not any(path.endswith('/rpc/record_real_story_export') for path in scenario.paths)
