"""Synthetic encrypted transfers only: no real keys, accounts or financial files."""
from copy import deepcopy
import base64
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import sqlite3
import stat
import zipfile

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from scripts import import_staging_bundle as importer
from scripts.staging_state import create_backup
from tests.test_ai_budget_accounting import budget, NOW, USER_A, user, reserve, complete

KEY=base64.urlsafe_b64encode(b'synthetic-transfer-key-32-bytes!!'[:32]).decode()


@pytest.fixture
def bundle(budget,tmp_path):
    folder,approval,ledger,policy,data,rules,write,make=budget
    data['expires_at']='2030-01-01T00:00:00Z';write(approval,data)
    with user():
        rid=reserve(make());complete(make(),rid)
    with sqlite3.connect(ledger) as con:
        con.execute('CREATE TABLE additional_history(id TEXT PRIMARY KEY, amount INTEGER)')
        con.execute("INSERT INTO additional_history VALUES ('do-not-change',750000)")
    usage=folder/'usage.jsonl';write(usage,{'version':1,'synthetic':True})
    snapshot=folder/'snapshot';create_backup(ledger,usage,snapshot)
    cohort=folder/'cohort.json';write(cohort,{'version':1,'approved_by':'Synthetic transfer test','user_ids':[USER_A]})
    entries={f'snapshot/{p.name}':p.read_bytes() for p in snapshot.iterdir()}
    entries.update({'controls/approval.json':approval.read_bytes(),'controls/budget-policy.json':policy.read_bytes(),
                    'controls/pilot-cohort.json':cohort.read_bytes()})
    parent=tmp_path/'destination';parent.mkdir(mode=0o700)
    cipher=tmp_path/'public-upload.enc'
    def seal(values=None,key=KEY,service_id=importer.EXPECTED_SERVICE_ID):
        cipher.write_bytes(importer.encrypt_bundle(entries if values is None else values,key,service_id=service_id))
        cipher.chmod(0o644)  # Ciphertext need not be private; plaintext always must.
        return hashlib.sha256(cipher.read_bytes()).hexdigest()
    return entries,parent,cipher,seal


def imported(bundle,values=None,key=KEY):
    entries,parent,cipher,seal=bundle
    digest=seal(entries if values is None else values)
    return importer.import_bundle(cipher,digest,parent/'runtime',key,clock=lambda:NOW)


def control(entries,name,mutate):
    changed=deepcopy(entries);data=json.loads(changed['controls/'+name]);mutate(data)
    changed['controls/'+name]=json.dumps(data).encode()
    return changed


def raw_zip(entries,*,extra=None,duplicate=False,symlink=False,compression=zipfile.ZIP_DEFLATED):
    stream=BytesIO()
    with zipfile.ZipFile(stream,'w',compression=compression) as out:
        for name,value in entries.items():
            if symlink and name=='controls/approval.json':
                info=zipfile.ZipInfo(name);info.external_attr=(stat.S_IFLNK|0o777)<<16
                out.writestr(info,value)
            else:out.writestr(name,value)
        if extra:out.writestr(extra,b'not-allowed')
        if duplicate:out.writestr('controls/approval.json',entries['controls/approval.json'])
    return stream.getvalue()


def seal_raw(payload,key=KEY,service=importer.EXPECTED_SERVICE_ID):
    salt,nonce=os.urandom(16),os.urandom(12)
    raw=base64.b64decode(key.encode(),altchars=b'-_',validate=True)
    derived=HKDF(algorithm=hashes.SHA256(),length=32,salt=salt,info=b'memy-staging-state-import-v1').derive(raw)
    aad=json.dumps({'version':1,'service_id':service},sort_keys=True,separators=(',',':')).encode()
    encrypted=AESGCM(derived).encrypt(nonce,payload,aad)
    return json.dumps({'version':1,'service_id':service,'salt':base64.urlsafe_b64encode(salt).decode(),
        'nonce':base64.urlsafe_b64encode(nonce).decode(),'ciphertext':base64.urlsafe_b64encode(encrypted).decode()}).encode()


def test_round_trip_preserves_every_snapshot_control_byte_and_all_tables(bundle):
    entries,parent,cipher,seal=bundle;before=dict(entries);digest=seal()
    result=importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    target=parent/'runtime'
    assert result['imported'] and result['history_preserved'] and result['remote_hold_retained']
    assert result['reservations']==1 and result['cohort_members']==1
    assert not result['providers_enabled'] and not result['spending_approved'] and not result['history_rewritten']
    assert (target.stat().st_mode&0o777)==0o700
    assert {p.name for p in target.iterdir()}=={name.split('/')[1] for name in entries}
    for name,value in entries.items():
        output=target/name.split('/')[1]
        assert output.read_bytes()==value and output.stat().st_mode&0o777==0o600
    with sqlite3.connect(target/'ledger.sqlite3') as con:
        assert con.execute('SELECT * FROM additional_history').fetchall()==[('do-not-change',750000)]
    assert entries==before
    assert not list(parent.glob('.memy-import-*'))


def test_encoder_is_randomized_and_never_contains_plaintext_or_key(bundle):
    entries,*_=bundle
    first=importer.encrypt_bundle(entries,KEY);second=importer.encrypt_bundle(entries,KEY)
    assert first!=second and KEY.encode() not in first
    a,b=json.loads(first),json.loads(second)
    assert a['salt']!=b['salt'] and a['nonce']!=b['nonce']


@pytest.mark.parametrize('key',['','not-base64','eA==',base64.b64encode(b'x'*32).decode()])
def test_wrong_or_invalid_speech_key_never_creates_output(bundle,key):
    with pytest.raises(Exception):imported(bundle,key=key)
    assert not (bundle[1]/'runtime').exists() and not list(bundle[1].iterdir())


def test_wrong_cipher_digest_rejected_before_plaintext_or_output(bundle):
    _,parent,cipher,seal=bundle;seal()
    with pytest.raises(Exception):importer.import_bundle(cipher,'0'*64,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


@pytest.mark.parametrize('mutation',[
    lambda e:e.update(version=True),lambda e:e.update(service_id='srv-another1234567890'),
    lambda e:e.update(extra='never-print-key'),lambda e:e.update(salt='eA=='),lambda e:e.update(nonce='eA=='),
    lambda e:e.update(ciphertext=e['ciphertext'][:-4]+'AAAA'),
])
def test_authenticated_envelope_tampering_fails_even_with_updated_outer_hash(bundle,mutation):
    _,parent,cipher,seal=bundle;seal();envelope=json.loads(cipher.read_bytes());mutation(envelope)
    cipher.write_text(json.dumps(envelope));digest=hashlib.sha256(cipher.read_bytes()).hexdigest()
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


def test_wrong_service_bound_aad_cannot_be_relabelled_for_this_service(bundle):
    _,parent,cipher,seal=bundle;seal(service_id='srv-another1234567890')
    envelope=json.loads(cipher.read_bytes());envelope['service_id']=importer.EXPECTED_SERVICE_ID
    cipher.write_text(json.dumps(envelope));digest=hashlib.sha256(cipher.read_bytes()).hexdigest()
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


@pytest.mark.parametrize('case',['duplicate','traversal','absolute','extra','missing','symlink','unsupported-compression'])
def test_exact_zip_members_and_regular_file_types_are_required(bundle,case):
    entries,parent,cipher,_=bundle;values=dict(entries)
    if case=='missing':values.pop('controls/approval.json')
    payload=raw_zip(values,duplicate=case=='duplicate',symlink=case=='symlink',
        extra={'traversal':'../escape','absolute':'/tmp/escape','extra':'controls/key.env'}.get(case),
        compression=zipfile.ZIP_BZIP2 if case=='unsupported-compression' else zipfile.ZIP_DEFLATED)
    cipher.write_bytes(seal_raw(payload));digest=hashlib.sha256(cipher.read_bytes()).hexdigest()
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


@pytest.mark.parametrize('name,mutation',[
    ('approval.json',lambda v:v.update(budget_microusd=20000001)),
    ('approval.json',lambda v:v.update(expires_at='2020-01-01T00:00:00Z')),
    ('approval.json',lambda v:v.update(allowed_models=['not-an-approved-model'])),
    ('approval.json',lambda v:v.update(reserve_per_call_microusd=0)),
    ('budget-policy.json',lambda v:v.update(external_hold_microusd=0)),
    ('budget-policy.json',lambda v:v.update(subject_salt='34'*32)),
    ('budget-policy.json',lambda v:v.update(policy_id='not-recorded-policy')),
    ('budget-policy.json',lambda v:v.update(global_budget_microusd=11000000)),
    ('budget-policy.json',lambda v:v.update(per_user_budget_microusd=0)),
    ('pilot-cohort.json',lambda v:v.update(user_ids=[])),
    ('pilot-cohort.json',lambda v:v.update(user_ids=[USER_A,USER_A])),
])
def test_unapproved_controls_namespace_hold_or_policy_binding_fail_closed(bundle,name,mutation):
    changed=control(bundle[0],name,mutation)
    with pytest.raises(Exception):imported(bundle,changed)
    assert not list(bundle[1].iterdir())


def test_snapshot_hash_tampering_never_creates_output(bundle):
    changed=dict(bundle[0]);changed['snapshot/usage.jsonl']+=b'changed'
    with pytest.raises(Exception):imported(bundle,changed)
    assert not list(bundle[1].iterdir())


@pytest.mark.parametrize('kind',['directory','file','symlink'])
def test_existing_or_linked_target_is_never_overwritten(bundle,kind):
    _,parent,cipher,seal=bundle;digest=seal();target=parent/'runtime'
    if kind=='directory':target.mkdir(mode=0o700);(target/'sentinel').write_bytes(b'preserve')
    elif kind=='file':target.write_bytes(b'preserve')
    else:target.symlink_to(parent/'missing')
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,target,KEY,clock=lambda:NOW)
    if kind=='directory':assert (target/'sentinel').read_bytes()==b'preserve'
    elif kind=='file':assert target.read_bytes()==b'preserve'
    else:assert target.is_symlink()


def test_world_readable_plaintext_parent_is_rejected(bundle):
    _,parent,cipher,seal=bundle;digest=seal();parent.chmod(0o755)
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not (parent/'runtime').exists()


def test_source_cipher_symlink_is_rejected(bundle):
    _,parent,cipher,seal=bundle;digest=seal();linked=cipher.with_name('linked.enc');linked.symlink_to(cipher)
    with pytest.raises(Exception):importer.import_bundle(linked,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


def test_bounded_cipher_and_uncompressed_data_reject_without_output(bundle,monkeypatch):
    entries,parent,cipher,seal=bundle;digest=seal()
    monkeypatch.setattr(importer,'MAX_ENVELOPE_BYTES',10)
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())
    monkeypatch.setattr(importer,'MAX_ENVELOPE_BYTES',50_000_000)
    monkeypatch.setattr(importer,'MAX_BUNDLE_BYTES',1024)
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


def test_copy_failure_cleans_only_new_owned_output(bundle,monkeypatch):
    _,parent,cipher,seal=bundle;digest=seal();original=importer.write_new
    def fail(path,value):
        if path.parent==parent/'runtime' and path.name=='budget-policy.json':raise OSError('synthetic copy failure')
        return original(path,value)
    monkeypatch.setattr(importer,'write_new',fail)
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,parent/'runtime',KEY,clock=lambda:NOW)
    assert not list(parent.iterdir())


def test_concurrent_target_creation_is_never_removed_or_replaced(bundle,monkeypatch):
    _,parent,cipher,seal=bundle;digest=seal();target=parent/'runtime';original=Path.mkdir
    def race(path,*args,**kwargs):
        if path==target:
            original(path,mode=0o700);(path/'sentinel').write_bytes(b'concurrent-owner')
            raise FileExistsError('synthetic concurrent create')
        return original(path,*args,**kwargs)
    monkeypatch.setattr(Path,'mkdir',race)
    with pytest.raises(Exception):importer.import_bundle(cipher,digest,target,KEY,clock=lambda:NOW)
    assert (target/'sentinel').read_bytes()==b'concurrent-owner'


def test_cli_rejects_wrong_service_without_reading_any_cipher_or_key_file(monkeypatch,capsys):
    monkeypatch.setenv('RENDER_SERVICE_ID','srv-wrongservice12345')
    monkeypatch.setattr(importer,'_read_cipher',lambda *a:pytest.fail('Wrong service must not read ciphertext'))
    assert importer.main(['--expected-sha256','0'*64])==2
    output=capsys.readouterr().out
    assert json.loads(output)['code']=='STATE_IMPORT_REJECTED'
    assert 'srv-wrongservice12345' not in output


def test_cli_logs_only_fixed_failure_and_never_secret_or_path(bundle,monkeypatch,capsys):
    _,parent,cipher,seal=bundle;digest=seal()
    monkeypatch.setenv('RENDER_SERVICE_ID',importer.EXPECTED_SERVICE_ID)
    monkeypatch.setenv('REAL_AI_SPEECH_ENCRYPTION_KEY','never-print-this-key')
    assert importer.main(['--cipher-file',str(cipher),'--expected-sha256',digest,'--output',str(parent/'runtime')])==2
    output=capsys.readouterr().out
    assert 'never-print-this-key' not in output and str(cipher) not in output and str(parent) not in output
    assert json.loads(output)['imported'] is False
