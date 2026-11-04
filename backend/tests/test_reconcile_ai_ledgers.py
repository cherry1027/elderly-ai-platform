"""Read-only ledger comparison keeps the remote hold even after matching rows."""

import hashlib
import json
import shutil
import sqlite3

from app.services.ai_controls import AISpendingGovernor
from scripts.reconcile_ai_ledgers import main, report
from test_ai_budget_accounting import NOW, budget, user, reserve, complete


def copied_ledger(budget):
    with user():
        rid=reserve(budget[-1]())
        complete(budget[-1](),rid)
    remote=budget[0]/'remote.sqlite3'
    shutil.copyfile(budget[2],remote)
    remote.chmod(0o600)
    return remote


def test_absent_remote_evidence_retains_full_existing_hold_and_changes_nothing(budget):
    copied_ledger(budget)
    before=hashlib.sha256(budget[2].read_bytes()).hexdigest()
    data=report(budget[2])
    assert data['remote_hold_retained_microusd']==750_000
    assert not data['safe_to_release_remote_hold'] and not data['reconciliation_complete']
    assert data['local_settlements']==1
    assert hashlib.sha256(budget[2].read_bytes()).hexdigest()==before
    encoded=json.dumps(data)
    assert 'subject_salt' not in encoded and 'subject_digest' not in encoded


def test_remote_only_rows_are_reviewable_but_never_imported_or_refunded(budget):
    remote=copied_ledger(budget)
    remote_governor=AISpendingGovernor(budget[1],remote,clock=lambda:NOW,budget_policy_path=budget[3])
    with user(): reserve(remote_governor)
    before=hashlib.sha256(budget[2].read_bytes()).hexdigest()
    data=report(budget[2],remote)
    assert data['reservations_remote_only']==1 and data['append_only_import_reviewable']
    assert data['remote_only_gross_reserved_microusd']>0
    assert data['remote_hold_retained_microusd']==750_000 and not data['safe_to_release_remote_hold']
    assert hashlib.sha256(budget[2].read_bytes()).hexdigest()==before


def test_tampered_remote_reservations_raise_a_conflict_before_import(budget):
    remote=copied_ledger(budget)
    with sqlite3.connect(remote) as db:
        db.execute("UPDATE reservations SET model='unreviewed-model'")
    data=report(budget[2],remote)
    assert data['reservations_conflicts']==1
    assert not data['append_only_import_reviewable']


def test_counter_corruption_fails_closed_without_leaking_details(budget,capsys):
    remote=copied_ledger(budget)
    with sqlite3.connect(remote) as db:
        db.execute('UPDATE approvals SET reserved_calls=0')
    assert main(['--local-ledger',str(budget[2]),'--remote-ledger',str(remote)])==1
    data=json.loads(capsys.readouterr().out)
    assert data['status']=='FAILED_CLOSED' and not data['history_modified']
    assert str(remote) not in json.dumps(data)
