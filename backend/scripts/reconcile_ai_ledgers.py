"""Read-only comparison before consolidating a remote pilot ledger.

This command NEVER imports, settles, refunds, replaces, resets or opens a new
approval. Its sanitized report deliberately retains the full configured remote
hold. A returned WSL ledger and usage evidence must be reviewed before an
administrator can authorize a separate append-only import.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import quote
from uuid import UUID

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.ai_budget import baseline_fingerprint
from app.services.ai_controls import _private_parent, _private_file, SUPPORTED_AI_OPERATIONS


MAX_ROWS = 100_000
MAX_BYTES = 100_000_000
_HEX = re.compile(r'[a-f0-9]{64}\Z')
_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z')
_MODEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,99}\Z')


def read_ledger(path):
    """Read an existing protected SQLite file without schema migration/writes."""
    path = Path(path)
    _private_parent(path)
    descriptor = os.open(path,os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        _private_file(info)
        if info.st_size > MAX_BYTES:
            raise ValueError('Ledger exceeds reviewed size')
        for suffix in ('-wal','-shm','-journal'):
            try:
                sidecar = path.with_name(path.name+suffix).lstat()
            except FileNotFoundError:
                continue
            _private_file(sidecar)
        # SQLite reads its consistent snapshot, including any valid local WAL.
        connection = sqlite3.connect('file:'+quote(str(path),safe='/')+'?mode=ro',uri=True)
        try:
            current = path.lstat()
            if (current.st_dev,current.st_ino)!=(info.st_dev,info.st_ino):
                raise ValueError('Ledger changed while opening')
            connection.execute('PRAGMA query_only=ON')
            connection.execute('PRAGMA trusted_schema=OFF')
            connection.execute('BEGIN')
            if (connection.execute('PRAGMA application_id').fetchone()[0] != 0x4D454D59
                or connection.execute('PRAGMA user_version').fetchone()[0] != 1
                or connection.execute('PRAGMA quick_check').fetchone() != ('ok',)):
                raise ValueError('Unsupported ledger')
            approvals = connection.execute('SELECT approval_id,digest,reserved_calls,reserved_microusd,last_reserved_at FROM approvals LIMIT ?', (MAX_ROWS+1,)).fetchall()
            rows = connection.execute('SELECT reservation_id,approval_id,operation,model,reserved_at,ceiling_microusd FROM reservations LIMIT ?', (MAX_ROWS+1,)).fetchall()
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            settlements = connection.execute('SELECT reservation_id,accounted_microusd,evidence_digest FROM usage_settlements LIMIT ?', (MAX_ROWS+1,)).fetchall() if 'usage_settlements' in tables else []
            subjects = connection.execute('SELECT reservation_id,subject_digest,policy_id FROM reservation_subjects LIMIT ?', (MAX_ROWS+1,)).fetchall() if 'reservation_subjects' in tables else []
            policies = connection.execute('SELECT policy_id,digest,subject_namespace_digest,accounting_core_digest FROM budget_policies LIMIT ?', (MAX_ROWS+1,)).fetchall() if 'budget_policies' in tables else []
            reviews = connection.execute('SELECT reservation_id,accounted_microusd,evidence_digest,reviewed_by,reviewed_at,reason FROM usage_overrun_reviews LIMIT ?', (MAX_ROWS+1,)).fetchall() if 'usage_overrun_reviews' in tables else []
            if any(len(collection)>MAX_ROWS for collection in (approvals,rows,settlements,subjects,policies,reviews)):
                raise ValueError('Too many ledger rows')
        finally:
            connection.close()
    finally:
        os.close(descriptor)
    by_approval = {row[0]:row for row in approvals}
    by_id = {row[0]:row for row in rows}
    if len(by_id) != len(rows) or len(by_approval) != len(approvals):
        raise ValueError('Duplicate ledger identity')
    for rid, aid, operation, model, stamp, ceiling in rows:
        if (not isinstance(rid,str) or str(UUID(rid))!=rid or aid not in by_approval
            or operation not in SUPPORTED_AI_OPERATIONS or not isinstance(model,str) or not _MODEL.fullmatch(model)
            or type(stamp) not in (int,float) or not math.isfinite(stamp) or stamp<0
            or type(ceiling) is not int or not 1<=ceiling<=2**53-1):
            raise ValueError('Malformed reservation')
    for aid, digest, calls, gross, stamp in approvals:
        selected = [row for row in rows if row[1]==aid]
        if (not isinstance(aid,str) or not _ID.fullmatch(aid) or not isinstance(digest,str) or not _HEX.fullmatch(digest)
            or type(calls) is not int or type(gross) is not int or calls!=len(selected) or gross!=sum(row[5] for row in selected)
            or type(stamp) not in (int,float) or not math.isfinite(stamp)):
            raise ValueError('Inconsistent approval counters')
    for rid, amount, evidence in settlements:
        if rid not in by_id or type(amount) is not int or amount<0 or not isinstance(evidence,str) or not _HEX.fullmatch(evidence):
            raise ValueError('Malformed settlement')
    for policy_id, digest, namespace, core_digest in policies:
        if not isinstance(policy_id,str) or not _ID.fullmatch(policy_id) or not all(isinstance(v,str) and _HEX.fullmatch(v) for v in (digest,namespace,core_digest)):
            raise ValueError('Malformed policy')
    policy_ids = {row[0] for row in policies}
    for rid, subject, policy_id in subjects:
        if rid not in by_id or policy_id not in policy_ids or not isinstance(subject,str) or not _HEX.fullmatch(subject):
            raise ValueError('Malformed subject allocation')
    for rid, amount, evidence, reviewer, stamp, reason in reviews:
        if (rid not in by_id or type(amount) is not int or amount<0
            or not isinstance(evidence,str) or not _HEX.fullmatch(evidence)
            or not isinstance(reviewer,str) or not _ID.fullmatch(reviewer)
            or type(stamp) not in (int,float) or not math.isfinite(stamp)
            or reason != 'transcription_duration_rounding_v1'):
            raise ValueError('Malformed overrun review')
    return {'approvals':approvals,'reservations':rows,'usage_settlements':settlements,
            'usage_overrun_reviews':reviews,
            'reservation_subjects':subjects,'budget_policies':policies}


def _compare_rows(local, remote, key=0):
    left = {row[key]:row for row in local}
    right = {row[key]:row for row in remote}
    shared = left.keys() & right.keys()
    conflicts = [identity for identity in shared if left[identity]!=right[identity]]
    return len(shared), len(right.keys()-left.keys()), len(conflicts)


def report(local_path, remote_path=None, *, remote_hold_microusd=750_000):
    if type(remote_hold_microusd) is not int or not 0<=remote_hold_microusd<=2**53-1:
        raise ValueError('Invalid existing hold')
    local = read_ledger(local_path)
    rows = local['reservations']
    result = {'version':1,'mode':'read-only','history_modified':False,
        'local_reservations':len(rows),'local_approvals':len(local['approvals']),
        'local_settlements':len(local['usage_settlements']),
        'local_overrun_reviews':len(local['usage_overrun_reviews']),
        'local_gross_reserved_microusd':sum(row[5] for row in rows),
        'local_baseline_sha256':baseline_fingerprint(rows),
        'local_operation_counts':dict(sorted(Counter(row[2] for row in rows).items())),
        'remote_ledger_returned':remote_path is not None,
        'remote_hold_retained_microusd':remote_hold_microusd,
        'reconciliation_complete':False,'safe_to_release_remote_hold':False,
        'billing_basis':'Reservations and public-rate settlements are not provider invoices.'}
    if remote_path is None:
        result['next_action']='Keep the entire remote hold until the WSL ledger and provider usage observations are returned and reviewed.'
        return result
    remote = read_ledger(remote_path)
    # Approval counters legitimately diverge after a shared snapshot; immutable
    # approval identity/digest must still match. Reservations never may differ.
    conflicts = 0
    for table in ('reservations','usage_settlements','reservation_subjects','budget_policies','usage_overrun_reviews'):
        shared, unique, bad = _compare_rows(local[table],remote[table])
        result[table+'_shared']=shared
        result[table+'_remote_only']=unique
        result[table+'_conflicts']=bad
        conflicts += bad
    _, _, approval_conflicts = _compare_rows([row[:2] for row in local['approvals']], [row[:2] for row in remote['approvals']])
    result['approval_identity_conflicts']=approval_conflicts
    conflicts += approval_conflicts
    local_ids = {row[0] for row in rows}
    remote_only = [row for row in remote['reservations'] if row[0] not in local_ids]
    result['remote_only_gross_reserved_microusd']=sum(row[5] for row in remote_only)
    result['append_only_import_reviewable']=conflicts==0
    result['next_action']=('Resolve conflicting immutable rows before any import.' if conflicts else
        'Review the returned provider usage log and authorize an append-only import separately; this report does not release the remote hold.')
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-ledger',required=True,type=Path)
    parser.add_argument('--remote-ledger',type=Path)
    parser.add_argument('--remote-hold-microusd',type=int,default=750_000)
    args=parser.parse_args(argv)
    try:
        result=report(args.local_ledger,args.remote_ledger,remote_hold_microusd=args.remote_hold_microusd)
    except (OSError,ValueError,TypeError,sqlite3.Error,UnicodeError,OverflowError):
        print(json.dumps({'status':'FAILED_CLOSED','mode':'read-only','history_modified':False,
                          'reason':'Ledger unavailable, unsafe or inconsistent; no state was changed.'}))
        return 1
    print(json.dumps(result,indent=2,sort_keys=True))
    return 0


if __name__=='__main__':
    sys.exit(main())
