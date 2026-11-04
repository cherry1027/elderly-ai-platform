"""Synthetic pilot policies: no real ledger, credentials or provider requests."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import sqlite3
from threading import Barrier
from uuid import uuid4

import httpx
from pydantic import SecretStr
import pytest

from app.core.errors import APIError
from app.services.ai_controls import AISpendingGovernor, ai_budget_subject
from app.services.ai_budget import baseline_fingerprint, request_ceiling_microusd
from app.services.ai_usage import UsageObserver
from app.services.openai_client import OpenAIClient

NOW = datetime(2026, 11, 5, tzinfo=timezone.utc).timestamp()
USER_A, USER_B = str(uuid4()), str(uuid4())


@contextmanager
def user(who=USER_A):
    token = ai_budget_subject.set(who)
    try:
        yield
    finally:
        ai_budget_subject.reset(token)


@pytest.fixture
def budget(tmp_path):
    folder = tmp_path.resolve() / 'private'
    folder.mkdir(mode=0o700)
    approval = folder / 'approval.json'
    ledger = folder / 'ledger.sqlite3'
    policy = folder / 'policy.json'
    data = {'approval_id':'fictional-pilot', 'approved_by':'Synthetic fixture',
        'expires_at':'2026-11-06T00:00:00Z','max_calls':100,'max_calls_per_minute':100,
        'budget_microusd':500_000,'reserve_per_call_microusd':250_000,
        'allowed_models':['gpt-6.1-terra','gpt-transcribe','gpt-realtime-2.1-mini']}
    rules = {'version':1,'policy_id':'synthetic-policy','approved_by':'Synthetic fixture',
        'global_budget_microusd':10_500_000,'baseline_exposure_microusd':9_030_000,
        'baseline_reservation_ids':[],'baseline_sha256':baseline_fingerprint([]),
        'external_hold_microusd':750_000,'per_user_budget_microusd':500_000,
        'per_user_max_calls':50,'subject_salt':'12'*32}

    def write(path, value):
        path.write_text(json.dumps(value))
        path.chmod(0o600)
    write(approval, data)
    write(policy, rules)

    def governor():
        return AISpendingGovernor(approval, ledger, clock=lambda:NOW, budget_policy_path=policy)
    return folder, approval, ledger, policy, data, rules, write, governor


def err(code, action):
    with pytest.raises(APIError) as caught:
        action()
    assert caught.value.code == code


def reserve(governor):
    return governor.reserve_request('conversation','gpt-6.1-terra',input_bytes=1000,max_output_tokens=100)


def complete(governor, rid, **changes):
    governor.settle(rid, 'conversation', 'gpt-6.1-terra',
        {'input_tokens':100,'output_tokens':20,'total_tokens':120,**changes},
        status='completed',service_tier='default')


def test_future_success_settles_without_rewriting_gross_history(budget):
    _, _, ledger, _, _, _, _, make = budget
    instance = make()
    with user():
        rid = reserve(instance)
        with sqlite3.connect(ledger) as db:
            before = db.execute('SELECT * FROM reservations').fetchall()
            gross = db.execute('SELECT reserved_microusd FROM approvals').fetchone()[0]
        complete(instance,rid)
        complete(instance,rid)  # Exact evidence is idempotent.
        with sqlite3.connect(ledger) as db:
            assert db.execute('SELECT * FROM reservations').fetchall() == before
            assert db.execute('SELECT reserved_microusd FROM approvals').fetchone()[0] == gross
            assert db.execute('SELECT accounted_microusd FROM usage_settlements').fetchone() == (251,)
        assert gross == request_ceiling_microusd('gpt-6.1-terra',1000,100)


def test_normal_short_conversations_fit_after_usage_settlement(budget):
    _, _, ledger, _, data, _, write, make = budget
    data['budget_microusd'] = 250_000
    write(budget[1],data)
    with user():
        for _ in range(30):
            instance = make()  # Restart cannot reset, and does not lose settlements.
            rid = reserve(instance)
            complete(instance,rid)
        with sqlite3.connect(ledger) as db:
            assert db.execute('SELECT count(*) FROM reservations').fetchone()[0] == 30
            assert db.execute('SELECT sum(accounted_microusd) FROM usage_settlements').fetchone()[0] == 7_530


@pytest.mark.parametrize('usage,status,tier',[
    ({},'completed','default'), ({'input_tokens':100,'output_tokens':20},'failed','default'),
    ({'input_tokens':100,'output_tokens':20},'completed','unknown'),
    ({'input_tokens':100,'output_tokens':20,'total_tokens':999},'completed','default'),
    ({'input_tokens':True,'output_tokens':20},'completed','default'),
])
def test_unknown_failed_and_inconsistent_usage_retains_full_hold(budget,usage,status,tier):
    _, _, ledger, _, _, _, _, make = budget
    with user():
        instance = make(); rid = reserve(instance)
        instance.settle(rid,'conversation','gpt-6.1-terra',usage,status=status,service_tier=tier)
    with sqlite3.connect(ledger) as db:
        assert db.execute('SELECT count(*) FROM usage_settlements').fetchone() == (0,)


def test_missing_untrusted_identity_cannot_reserve(budget):
    for invalid in [None,'frontend-user-id','tasrva23@example.invalid']:
        with user(invalid):
            err('AI_USER_LIMIT_UNAVAILABLE',lambda:reserve(budget[-1]()))
    assert not budget[2].exists()


def test_per_user_cap_does_not_block_another_users_approved_allowance(budget):
    rules = budget[5]; rules['per_user_max_calls'] = 1; budget[6](budget[3],rules)
    with user(USER_A):
        rid = reserve(budget[-1]()); complete(budget[-1](),rid)
        err('AI_USER_BUDGET_EXHAUSTED',lambda:reserve(budget[-1]()))
    with user(USER_B):
        reserve(budget[-1]())
    assert USER_A.encode() not in budget[2].read_bytes()
    assert USER_B.encode() not in budget[2].read_bytes()


def test_global_limit_spans_users_and_preserves_remote_hold(budget):
    rules = budget[5]
    rules['global_budget_microusd'] = rules['baseline_exposure_microusd'] + rules['external_hold_microusd'] + 3000
    budget[6](budget[3],rules)
    with user(USER_A):
        reserve(budget[-1]())
    with user(USER_B):
        err('AI_GLOBAL_BUDGET_EXHAUSTED',lambda:reserve(budget[-1]()))


def test_policy_or_identity_namespace_cannot_be_changed_to_reset_allowance(budget):
    with user():
        reserve(budget[-1]())
    rules = budget[5]; rules['per_user_max_calls'] = 100
    budget[6](budget[3],rules)
    with user():
        err('AI_USAGE_UNAVAILABLE',lambda:reserve(budget[-1]()))
    rules['policy_id'] = 'new-policy'; rules['subject_salt'] = '34'*32
    budget[6](budget[3],rules)
    with user():
        err('AI_USAGE_UNAVAILABLE',lambda:reserve(budget[-1]()))


def test_cross_approval_cumulative_cap_never_resets(budget):
    rules = budget[5]
    rules['global_budget_microusd'] = rules['baseline_exposure_microusd'] + rules['external_hold_microusd'] + 3000
    budget[6](budget[3],rules)
    with user():
        reserve(budget[-1]())
    data = budget[4]; data['approval_id'] = 'second-new-window'
    budget[6](budget[1],data)
    with user():
        err('AI_GLOBAL_BUDGET_EXHAUSTED',lambda:reserve(budget[-1]()))


def test_two_concurrent_users_cannot_overrun_shared_pool(budget):
    rules = budget[5]
    rules['global_budget_microusd'] = rules['baseline_exposure_microusd'] + rules['external_hold_microusd'] + 3000
    budget[6](budget[3],rules)
    gate = Barrier(2)
    def attempt(who):
        with user(who):
            gate.wait()
            try:
                return reserve(budget[-1]())
            except APIError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(attempt,[USER_A,USER_B]))
    assert rows.count('AI_GLOBAL_BUDGET_EXHAUSTED') == 1
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT count(*) FROM reservations').fetchone() == (1,)


def test_preflight_reports_used_call_limit_without_spending(budget):
    data=budget[4]; data['max_calls']=1; budget[6](budget[1],data)
    err('AI_USAGE_LIMIT',lambda:budget[-1]().check_budget(required_calls=2))
    assert not budget[2].exists()
    with user(): reserve(budget[-1]())
    err('AI_USAGE_LIMIT',lambda:budget[-1]().check_budget())


def test_legacy_baseline_must_match_all_pinned_immutable_rows(budget):
    folder, approval, ledger, policy, data, rules, write, make = budget
    legacy = AISpendingGovernor(approval,ledger,clock=lambda:NOW)
    old = legacy.reserve('conversation','gpt-6.1-terra')
    with sqlite3.connect(ledger) as db:
        old_rows = db.execute('SELECT * FROM reservations').fetchall()
    rules['baseline_reservation_ids']=[old]; rules['baseline_sha256']=baseline_fingerprint(old_rows)
    write(policy,rules)
    with user():
        reserve(make())
        err('AI_USAGE_UNAVAILABLE',lambda:complete(make(),old))  # No retrospective discount.
    with sqlite3.connect(ledger) as db:
        assert db.execute('SELECT * FROM reservations WHERE reservation_id=?',(old,)).fetchall()==old_rows
        db.execute('UPDATE reservations SET model=? WHERE reservation_id=?',('tampered-model',old))
    with user(): err('AI_USAGE_UNAVAILABLE',lambda:reserve(make()))


def test_usage_above_ceiling_is_recorded_and_blocks_future_dispatch(budget):
    with user():
        instance=budget[-1](); rid=reserve(instance)
        err('AI_USAGE_UNAVAILABLE',lambda:complete(instance,rid,input_tokens=1_000_000,output_tokens=20,total_tokens=1_000_020))
        err('AI_USAGE_UNAVAILABLE',lambda:reserve(budget[-1]()))


def test_observation_does_not_settle_a_different_model_or_conflicting_evidence(budget):
    with user():
        instance=budget[-1](); rid=reserve(instance)
        err('AI_USAGE_UNAVAILABLE',lambda:instance.settle(rid,'memory_extraction','gpt-6.1-terra',{'input_tokens':1,'output_tokens':1},status='completed',service_tier='default'))
        complete(instance,rid)
        err('AI_USAGE_UNAVAILABLE',lambda:complete(instance,rid,input_tokens=101,total_tokens=121))


def test_transport_reserves_bound_and_records_usage_before_settlement(budget):
    folder, _, ledger, _, _, _, _, make=budget
    def handler(request):
        body=json.loads(request.content)
        return httpx.Response(200,json={'status':'completed','service_tier':'default',
            'usage':{'input_tokens':100,'output_tokens':20,'total_tokens':120},
            'output':[{'type':'message','role':'assistant','status':'completed',
                'content':[{'type':'output_text','text':'{"text":"Hej"}'}]}]})
    client=OpenAIClient(SecretStr('synthetic-not-a-secret'),'gpt-6.1-terra',make(),
        transport=httpx.MockTransport(handler),usage_observer=UsageObserver(folder/'usage.jsonl'))
    async def run():
        return await client.structured('conversation','Be kind.',{'language':'sv','text':'Hej'},
            {'type':'object','properties':{'text':{'type':'string'}},'required':['text'],'additionalProperties':False},max_output_tokens=100)
    with user(): assert asyncio.run(run())=={'text':'Hej'}
    with sqlite3.connect(ledger) as db:
        assert db.execute('SELECT count(*) FROM usage_settlements').fetchone() == (1,)
        assert db.execute('SELECT ceiling_microusd FROM reservations').fetchone()[0] < 250_000
    assert json.loads((folder/'usage.jsonl').read_text())['status']=='completed'


@pytest.mark.parametrize('field,value',[
    ('global_budget_microusd',20_000_000),('baseline_exposure_microusd',0),
    ('external_hold_microusd',0),
])
def test_new_policy_id_cannot_rebase_accounting_or_release_remote_hold(budget,field,value):
    with user(): reserve(budget[-1]())
    rules=budget[5]; rules['policy_id']='next-policy'; rules[field]=value
    budget[6](budget[3],rules)
    with user(): err('AI_USAGE_UNAVAILABLE',lambda:reserve(budget[-1]()))


def test_removing_policy_path_cannot_turn_off_global_limits(budget):
    with user(): reserve(budget[-1]())
    legacy=AISpendingGovernor(budget[1],budget[2],clock=lambda:NOW)
    err('AI_USAGE_UNAVAILABLE',lambda:legacy.reserve('conversation','gpt-6.1-terra'))
    err('AI_USAGE_UNAVAILABLE',lambda:legacy.check_budget())


def test_workflow_lock_covers_entire_multistage_action_without_spending(budget):
    make=budget[-1]
    def competing():
        try:
            with make().workflow():
                return 'unexpected-lock'
        except APIError as error:
            return error.code
    with make().workflow():
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(competing).result()=='AI_BUSY'
    with make().workflow():
        pass
    assert not budget[2].exists()


def test_full_request_group_checks_all_required_budget_before_first_stage(budget):
    # Two individually valid text requests together exceed the remaining global pool.
    rules=budget[5]
    rules['global_budget_microusd']=rules['baseline_exposure_microusd']+rules['external_hold_microusd']+3000
    budget[6](budget[3],rules)
    with user(),budget[-1]().workflow():
        err('AI_GLOBAL_BUDGET_EXHAUSTED',lambda:budget[-1]().check_request_group([
            ('gpt-6.1-terra',1000,100),('gpt-6.1-terra',1000,100)]))
    assert not budget[2].exists()


def test_transcription_reserves_from_validated_bounded_duration(budget):
    with user():
        instance=budget[-1]()
        rid=instance.reserve_transcription('gpt-transcribe',90)
        instance.settle(rid,'transcription','gpt-transcribe',{'seconds':90},status='completed')
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT ceiling_microusd FROM reservations').fetchone()==(8534,)
        assert db.execute('SELECT accounted_microusd FROM usage_settlements').fetchone()==(8439,)


def test_speech_dynamic_bound_uses_highest_audio_rate_and_output_limit(budget):
    with user():
        instance=budget[-1]()
        rid=instance.reserve_request('speech_synthesis','gpt-realtime-2.1-mini',input_bytes=1000,max_output_tokens=1536)
        instance.settle(rid,'speech_synthesis','gpt-realtime-2.1-mini',{'input_tokens':100,'output_tokens':100},status='completed')
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT ceiling_microusd FROM reservations').fetchone()==(50_902,)
        assert db.execute('SELECT accounted_microusd FROM usage_settlements').fetchone()==(3751,)


def test_multicall_preflight_respects_the_entire_rolling_rate_allowance(budget):
    data=budget[4]; data['max_calls_per_minute']=1; budget[6](budget[1],data)
    with user():
        err('AI_RATE_LIMIT',lambda:budget[-1]().check_request_group([
            ('gpt-6.1-terra',1000,100),('gpt-6.1-terra',1000,100)]))
    assert not budget[2].exists()
    data['max_calls_per_minute']=2; budget[6](budget[1],data)
    with user():
        reserve(budget[-1]())
        err('AI_RATE_LIMIT',lambda:budget[-1]().check_request_group([
            ('gpt-6.1-terra',1000,100),('gpt-6.1-terra',1000,100)]))
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT count(*) FROM reservations').fetchone()==(1,)


def test_fresh_ledger_group_preflight_checks_individual_attempt_and_cost_caps(budget):
    rules=budget[5]; rules['per_user_max_calls']=1; budget[6](budget[3],rules)
    with user():
        err('AI_USER_BUDGET_EXHAUSTED',lambda:budget[-1]().check_request_group([
            ('gpt-6.1-terra',1000,100),('gpt-6.1-terra',1000,100)]))
    assert not budget[2].exists()
    rules['per_user_max_calls']=50; rules['per_user_budget_microusd']=2000; budget[6](budget[3],rules)
    with user():
        err('AI_USER_BUDGET_EXHAUSTED',lambda:budget[-1]().check_request_group([
            ('gpt-6.1-terra',1000,100),('gpt-6.1-terra',1000,100)]))
    assert not budget[2].exists()


def transcription_observation(rid, seconds=7):
    return {'version':1,'timestamp':'2026-11-05T00:00:00+00:00',
        'operation':'transcription','model':'gpt-transcribe','reservation_id':rid,
        'status':'completed','service_tier':None,'usage':{'seconds':seconds}}


def test_fractional_transcription_bound_covers_provider_whole_second_rounding(budget):
    from app.services.ai_budget import transcription_ceiling_microusd
    assert transcription_ceiling_microusd(6.23)==752
    with user():
        instance=budget[-1]()
        rid=instance.reserve_transcription('gpt-transcribe',6.23)
        instance.settle(rid,'transcription','gpt-transcribe',{'seconds':7},status='completed')
        instance.check_budget()
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT ceiling_microusd FROM reservations').fetchone()==(752,)
        assert db.execute('SELECT accounted_microusd FROM usage_settlements').fetchone()==(658,)
        assert db.execute('SELECT count(*) FROM usage_overrun_reviews').fetchone()==(0,)


def test_known_duration_overrun_needs_explicit_review_and_counts_full_charge(budget):
    from app.services.ai_budget import accounting, load_policy
    with user():
        instance=budget[-1]()
        # Reproduce the old observed reservation, never rewrite it after billing.
        rid=instance.reserve('transcription','gpt-transcribe',_ceiling_microusd=585)
        err('AI_USAGE_UNAVAILABLE',lambda:instance.settle(rid,'transcription','gpt-transcribe',{'seconds':7},status='completed'))
        err('AI_USAGE_UNAVAILABLE',lambda:instance.check_budget())
    with sqlite3.connect(budget[2]) as db:
        original_reservations=db.execute('SELECT * FROM reservations').fetchall()
        original_settlements=db.execute('SELECT * FROM usage_settlements').fetchall()
        original_approvals=db.execute('SELECT * FROM approvals').fetchall()
    result=instance.review_transcription_rounding(rid,transcription_observation(rid),reviewed_by='authorized-test-administrator')
    assert result=={'review_recorded':True,'original_ceiling_microusd':585,'full_accounted_microusd':658,'historical_rows_rewritten':False}
    instance.review_transcription_rounding(rid,transcription_observation(rid),reviewed_by='authorized-test-administrator')
    with user(): instance.check_budget()
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT * FROM reservations').fetchall()==original_reservations
        assert db.execute('SELECT * FROM usage_settlements').fetchall()==original_settlements
        assert db.execute('SELECT * FROM approvals').fetchall()==original_approvals
        assert db.execute('SELECT count(*) FROM usage_overrun_reviews').fetchone()==(1,)
        totals=accounting(db,load_policy(budget[3]))
        assert totals['global_accounted_microusd']==9_030_000+750_000+658
    # A review is not permission to alter the usage or the immutable reviewer.
    err('AI_USAGE_UNAVAILABLE',lambda:instance.review_transcription_rounding(rid,transcription_observation(rid,8),reviewed_by='authorized-test-administrator'))
    err('AI_USAGE_UNAVAILABLE',lambda:instance.review_transcription_rounding(rid,transcription_observation(rid),reviewed_by='another-administrator'))


def test_review_cannot_waive_large_or_non_transcription_overruns(budget):
    with user():
        instance=budget[-1]()
        rid=instance.reserve('transcription','gpt-transcribe',_ceiling_microusd=1)
        err('AI_USAGE_UNAVAILABLE',lambda:instance.settle(rid,'transcription','gpt-transcribe',{'seconds':7},status='completed'))
    err('AI_USAGE_UNAVAILABLE',lambda:instance.review_transcription_rounding(rid,transcription_observation(rid),reviewed_by='authorized-test-administrator'))
    err('AI_USAGE_UNAVAILABLE',lambda:instance.check_budget())
    with sqlite3.connect(budget[2]) as db:
        assert db.execute('SELECT count(*) FROM usage_overrun_reviews').fetchone()==(0,)
