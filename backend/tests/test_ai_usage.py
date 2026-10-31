"""Offline numeric usage evidence: no credential, account or provider access."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import json
import os
from pathlib import Path
from uuid import uuid4

import pytest

from app.core.errors import APIError
from app.services.ai_usage import UsageObserver, sanitize_usage


@pytest.fixture
def private(tmp_path):
    folder=tmp_path/'private'
    folder.mkdir(mode=0o700)
    return folder/'usage.jsonl'


def test_records_only_numeric_usage_not_private_payload(private):
    recorder=UsageObserver(private,clock=lambda:1_800_000_000)
    recorder.record('conversation','gpt-6.1-terra',{
        'input_tokens':1000,'output_tokens':100,'total_tokens':1100,
        'input_tokens_details':{'cached_tokens':500,'private_text':'PRIVATE'},
        'output_tokens_details':{'reasoning_tokens':30},
        'prompt':'PRIVATE','api_key':'SECRET','user_id':'PRIVATE'},
        reservation_id=uuid4(),service_tier='default')
    row=json.loads(private.read_text())
    assert row['usage']=={'input_tokens':1000,'output_tokens':100,'total_tokens':1100,'cached_input_tokens':500,'reasoning_tokens':30}
    assert 'PRIVATE' not in private.read_text() and 'SECRET' not in private.read_text()
    assert private.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize('value',[None,[],True,'private text',{'input_tokens':True,'output_tokens':-1,'seconds':float('nan')},
    {'input_tokens':2**53,'seconds':float('inf')},{'input_tokens_details':{'cached_tokens':'secret'}}])
def test_malformed_usage_is_skipped_not_echoed(value):
    assert sanitize_usage(value)=={}


def test_supports_responses_realtime_and_duration_fields():
    assert sanitize_usage({'input_tokens':10,'output_tokens':20,'input_token_details':{'audio_tokens':0,'text_tokens':10,'cached_tokens':2},
        'output_token_details':{'audio_tokens':18,'text_tokens':2},'seconds':1.5})=={
        'input_tokens':10,'output_tokens':20,'input_audio_tokens':0,'input_text_tokens':10,'cached_input_tokens':2,
        'output_audio_tokens':18,'output_text_tokens':2,'seconds':1.5}


@pytest.mark.parametrize('metadata',[
    {'operation':'private prompt'},{'model':'secret key with spaces'},{'status':'SECRET'},
    {'service_tier':'private'},{'reservation_id':'SECRET'},
])
def test_invalid_metadata_fails_without_exposing_values(private,metadata):
    kwargs={'operation':'conversation','model':'gpt-6.1-terra','usage':{},**metadata}
    with pytest.raises(APIError) as error:UsageObserver(private).record(**kwargs)
    assert error.value.code=='AI_USAGE_UNAVAILABLE' and 'SECRET' not in error.value.message
    assert not private.exists()


def test_private_parent_exact_permissions_required(private):
    private.parent.chmod(0o755)
    with pytest.raises(APIError):UsageObserver(private)


def test_symlink_and_hardlink_files_are_rejected(private):
    target=private.parent/'other'
    target.write_text('')
    target.chmod(0o600)
    private.symlink_to(target)
    with pytest.raises(APIError):UsageObserver(private)
    private.unlink()
    os.link(target,private)
    with pytest.raises(APIError):UsageObserver(private)


def test_symlink_parent_is_rejected(tmp_path):
    actual=tmp_path/'actual'; actual.mkdir(mode=0o700)
    link=tmp_path/'link'; link.symlink_to(actual)
    with pytest.raises(APIError):UsageObserver(link/'usage.jsonl')


def test_log_replacement_and_disappearance_fail_closed(private):
    recorder=UsageObserver(private)
    recorder.record('conversation','gpt-6.1-terra',{})
    old=private.with_suffix('.old'); private.rename(old)
    with pytest.raises(APIError):recorder.summarize()
    private.write_text(''); private.chmod(0o600)
    with pytest.raises(APIError):recorder.record('conversation','gpt-6.1-terra',{})


def test_duplicate_reservation_is_idempotent_but_conflict_rejected(private):
    recorder=UsageObserver(private)
    rid=uuid4()
    for _ in range(2):recorder.record('conversation','gpt-6.1-terra',{'input_tokens':1},reservation_id=rid)
    assert len(private.read_text().splitlines())==1
    with pytest.raises(APIError):recorder.record('conversation','gpt-6.1-terra',{'input_tokens':2},reservation_id=rid)


def test_concurrent_append_records_are_not_interleaved(private):
    def append(_):UsageObserver(private).record('conversation','gpt-6.1-terra',{'input_tokens':1},reservation_id=uuid4())
    with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(append,range(40)))
    assert len([json.loads(line) for line in private.read_text().splitlines()])==40


def test_summary_reports_estimates_reservations_and_unknowns_separately(private):
    observer=UsageObserver(private)
    observer.record('conversation','gpt-6.1-terra',{'input_tokens':1000,'output_tokens':100},reservation_id=uuid4(),service_tier='default')
    observer.record('speech_synthesis','gpt-realtime-2.1-mini',{'input_tokens':100,'output_tokens':100},reservation_id=uuid4())
    observer.record('transcription','gpt-transcribe',{'seconds':60},reservation_id=uuid4())
    observer.record('memory_extraction','gpt-6.1-terra',{},reservation_id=uuid4(),status='failed',service_tier='default')
    summary=observer.summarize(reserved_attempts=5)
    assert Decimal(summary['usage_derived_estimate_usd'])==Decimal('0.009')
    assert summary['reserved_ceiling_usd']=='2.50'
    assert summary['provider_usage_observations']==4
    assert summary['unmeasured_attempts']==2 and not summary['estimate_complete']
    assert summary['reported_usage_totals']['input_tokens']==1100
    assert 'not an invoice' in summary['billing_basis']


def test_cached_reasoning_tokens_are_not_double_counted(private):
    observer=UsageObserver(private)
    observer.record('story_writer','gpt-6.1-terra',{'input_tokens':1000,'output_tokens':100,
        'input_tokens_details':{'cached_tokens':900},'output_tokens_details':{'reasoning_tokens':80}},service_tier='default')
    assert Decimal(observer.summarize(reserved_attempts=1)['usage_derived_estimate_usd'])==Decimal('0.0015')


@pytest.mark.parametrize('model,tier',[('unsupported-model','default'),('gpt-6.1-terra',None),('gpt-6.1-terra','scale')])
def test_unknown_pricing_is_unmeasured(private,model,tier):
    observer=UsageObserver(private)
    observer.record('conversation',model,{'input_tokens':1,'output_tokens':1},service_tier=tier)
    summary=observer.summarize(reserved_attempts=1)
    assert summary['unmeasured_attempts']==1 and not summary['estimate_complete']


def test_empty_log_summary_does_not_create_file(private):
    summary=UsageObserver(private).summarize(reserved_attempts=2)
    assert summary['provider_usage_observations']==0 and summary['unmeasured_attempts']==2
    assert summary['reserved_ceiling_usd']=='1.00' and not private.exists()


@pytest.mark.parametrize('contents',['not json\n','{}\n','{}','[]\n'])
def test_corrupt_log_is_rejected_without_echo(private,contents):
    private.write_text(contents); private.chmod(0o600)
    with pytest.raises(APIError) as error:UsageObserver(private).summarize()
    assert error.value.message=='Live AI usage evidence is unavailable.'


def test_readonly_log_and_write_failure_raise_safe_error(private,monkeypatch):
    observer=UsageObserver(private)
    def denied(*args):raise OSError('PRIVATE')
    monkeypatch.setattr('app.services.ai_usage.os.write',denied)
    with pytest.raises(APIError) as error:observer.record('conversation','gpt-6.1-terra',{})
    assert 'PRIVATE' not in error.value.message


def test_duplicate_json_keys_are_rejected(private):
    observer=UsageObserver(private)
    observer.record('conversation','gpt-6.1-terra',{})
    private.write_text(private.read_text().replace('"version":1','"version":1,"version":1'))
    with pytest.raises(APIError):observer.summarize()


def test_inconsistent_provider_total_is_not_priced_as_complete(private):
    observer=UsageObserver(private)
    observer.record('conversation','gpt-6.1-terra',{'input_tokens':1,'output_tokens':2,'total_tokens':100},service_tier='default')
    summary=observer.summarize(reserved_attempts=1)
    assert summary['unmeasured_attempts']==1 and not summary['estimate_complete']
