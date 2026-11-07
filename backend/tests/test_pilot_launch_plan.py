"""Seven-person SEK planning is offline and never becomes spending authority."""
import json
from uuid import uuid4

import pytest

from scripts.pilot_preflight import (
    CHECKS, DEFAULT, DEFAULT_LAUNCH_PLAN, LAUNCH_DECISIONS, PILOT_BUDGET_SEK,
    PreflightError, assess, assess_launch_plan, main,
)


@pytest.fixture
def launch_plan():
    return json.loads(DEFAULT_LAUNCH_PLAN.read_bytes())


def encoded(value):
    return json.dumps(value).encode()


def reviewed(value):
    value['destinations'].update(web_origin='https://memy.example.com', api_origin='https://api.example.com',
        confirmation_redirect='https://memy.example.com/auth/confirm',
        recovery_redirect='https://memy.example.com/password-reset')
    value['decisions'] = dict.fromkeys(LAUNCH_DECISIONS, True)
    return value


def ready_manifest():
    manifest=json.loads(DEFAULT.read_bytes())
    manifest['backend']['review']=manifest['mobile']['review']='pass'
    manifest['checks']=dict.fromkeys(CHECKS,'pass')
    manifest['distribution']={'kind':'mobile_web','api_origin':'https://api.example.com'}
    manifest['testers']=[{'slot':i+1,'user_id':str(uuid4()),'account_ready':True,'password_setup_verified':True,
                         'sign_in_verified':True,'consent_recorded':True} for i in range(7)]
    return manifest


def test_public_plan_is_pending_and_budget_math_never_creates_a_usd_approval(launch_plan):
    before=DEFAULT_LAUNCH_PLAN.read_bytes()
    result=assess_launch_plan(encoded(launch_plan))
    assert result['planned_people']==7 and result['pilot_days']==7
    assert result['budget_sek']==PILOT_BUDGET_SEK
    assert result['budget_sek']['per_user_ai_cap']*7==175
    assert 100+175+75==result['budget_sek']['total_cap']==350
    assert len(result['blockers'])==len(LAUNCH_DECISIONS)+4
    assert not result['currency_conversion_performed'] and not result['approval_created']
    assert not result['spending_authorized'] and not result['release_authorized']
    assert DEFAULT_LAUNCH_PLAN.read_bytes()==before


def test_complete_self_report_still_does_not_authorize_spending_or_release(launch_plan):
    result=assess_launch_plan(encoded(reviewed(launch_plan)))
    assert result['blockers']==[]
    assert result['mode']=='offline-non-executable-plan'
    assert not result['currency_conversion_performed'] and not result['approval_created']
    assert not result['release_authorized'] and not result['spending_authorized']


@pytest.mark.parametrize('decision',LAUNCH_DECISIONS)
def test_each_missing_operator_decision_remains_a_fixed_blocker(launch_plan,decision):
    reviewed(launch_plan);launch_plan['decisions'][decision]=False
    assert assess_launch_plan(encoded(launch_plan))['blockers']==['launch_plan_'+decision]


@pytest.mark.parametrize('mutation',[
    lambda p:p.update(version=True), lambda p:p.update(planned_people=8),
    lambda p:p.update(planned_people=True), lambda p:p.update(pilot_days=8),
    lambda p:p.update(pilot_days=0), lambda p:p.update(OPENAI_API_KEY='never-print-key'),
    lambda p:p['budget_sek'].update(total_cap=351),
    lambda p:p['budget_sek'].update(total_cap=True),
    lambda p:p['budget_sek'].update(per_user_ai_cap=26),
    lambda p:p['budget_sek'].update(ai_cap=176,safety_reserve=74),
    lambda p:p['budget_sek'].update(usd_cap=350),
    lambda p:p['destinations'].update(supabase_project_ref='another-project'),
    lambda p:p['destinations'].update(api_origin='http://api.example.com'),
    lambda p:p['destinations'].update(api_origin='https://127.0.0.1'),
    lambda p:p['destinations'].update(web_origin='https://memy.example.com/'),
    lambda p:p['destinations'].update(api_origin='https://api.example.com?key=never-print'),
    lambda p:p['destinations'].update(confirmation_redirect='https://other.example.com/auth/confirm'),
    lambda p:p['destinations'].update(recovery_redirect='https://memy.example.com/reset?token=never-print'),
    lambda p:p['destinations'].update(recovery_redirect='https://memy.example.com/reset#token'),
    lambda p:p['destinations'].update(recovery_redirect='https://memy.example.com/a/../reset'),
    lambda p:p['destinations'].update(recovery_redirect='https://memy.example.com/%72eset'),
    lambda p:p['destinations'].update(recovery_redirect='https://memy.example.com/\\evil'),
    lambda p:p['destinations'].update(recovery_redirect='https://memy.example.com/reset\nprivate'),
    lambda p:p['destinations'].update(web_origin=None),
    lambda p:p['decisions'].update(runtime_approval_and_limits_verified=1),
    lambda p:p['decisions'].pop('existing_ledger_and_remote_hold_preserved'),
])
def test_malformed_or_budget_expanding_plans_fail_closed(launch_plan,mutation):
    reviewed(launch_plan);mutation(launch_plan)
    with pytest.raises(PreflightError):assess_launch_plan(encoded(launch_plan))


@pytest.mark.parametrize('raw',[b'',b'NaN',b'[]',b'{"version":1,"version":1}',b'\xff',b'x'*64001])
def test_launch_plan_json_is_strict_and_bounded(raw):
    with pytest.raises(PreflightError):assess_launch_plan(raw)


def test_unknown_destinations_are_pending_instead_of_invented(launch_plan):
    launch_plan['decisions']=dict.fromkeys(LAUNCH_DECISIONS,True)
    report=assess_launch_plan(encoded(launch_plan))
    assert report['blockers']==[
        'launch_plan_web_origin_pending','launch_plan_api_origin_pending',
        'launch_plan_confirmation_redirect_pending','launch_plan_recovery_redirect_pending']


def test_combined_report_preserves_all_existing_financial_and_release_blockers(launch_plan):
    launch_plan=reviewed(launch_plan)
    launch_plan['decisions']['existing_ledger_and_remote_hold_preserved']=False
    report=assess(encoded(ready_manifest()),launch_plan=encoded(launch_plan))
    assert report['result']=='NOT_READY'
    assert 'launch_plan_existing_ledger_and_remote_hold_preserved' in report['blockers']
    assert 'current_ledger_history_not_checked' in report['blockers']
    assert 'financial_backup_not_checked' in report['blockers']
    assert not report['spending_authorized'] and not report['accounting']['remote_hold_released']


def test_private_cli_launch_plan_prints_no_raw_destinations_or_account_ids(tmp_path,capsys,launch_plan):
    folder=tmp_path/'private';folder.mkdir(mode=0o700)
    manifest=folder/'pilot.json';plan=folder/'launch.json'
    roster=ready_manifest();manifest.write_bytes(encoded(roster));manifest.chmod(0o600)
    plan.write_bytes(encoded(reviewed(launch_plan)));plan.chmod(0o600)
    assert main(['--manifest',str(manifest),'--launch-plan',str(plan)])==3
    output=capsys.readouterr().out;report=json.loads(output)
    assert report['launch_plan']['checked'] and report['result']=='NOT_READY'
    assert 'https://memy.example.com' not in output and 'https://api.example.com' not in output
    assert all(t['user_id'] not in output for t in roster['testers'])
    assert str(folder) not in output


def test_unsafe_private_plan_and_secret_fields_do_not_leak(tmp_path,capsys,launch_plan):
    folder=tmp_path/'private';folder.mkdir(mode=0o700)
    plan=folder/'launch.json';plan.write_bytes(encoded(launch_plan));plan.chmod(0o644)
    assert main(['--launch-plan',str(plan)])==2
    output=capsys.readouterr().out
    assert json.loads(output)['result']=='INVALID_OR_UNSAFE_INPUT' and str(plan) not in output
    plan.chmod(0o600);launch_plan['OPENAI_API_KEY']='never-print-key';plan.write_bytes(encoded(launch_plan))
    assert main(['--launch-plan',str(plan)])==2
    output=capsys.readouterr().out
    assert 'never-print-key' not in output and 'OPENAI_API_KEY' not in output


def staged_manifest():
    manifest=ready_manifest()
    for tester in manifest['testers'][4:]:
        tester.update(user_id=None,account_ready=False,password_setup_verified=False,
                      sign_in_verified=False,consent_recorded=False)
    return manifest


def private_cohort(tmp_path, manifest, slots):
    folder=tmp_path/'cohort';folder.mkdir(mode=0o700)
    path=folder/'pilot-cohort.json'
    ids=[tester['user_id'] for tester in manifest['testers'] if tester['slot'] in slots]
    path.write_text(json.dumps({'version':1,'approved_by':'synthetic-test','user_ids':ids}))
    path.chmod(0o600)
    return path


def test_initial_four_are_checked_while_three_future_accounts_stay_pending(launch_plan,tmp_path):
    manifest=staged_manifest();cohort=private_cohort(tmp_path,manifest,{1,2,3,4})
    before=cohort.read_bytes()
    result=assess(encoded(manifest),launch_plan=encoded(reviewed(launch_plan)),cohort=cohort)
    assert result['ready_accounts']==result['active_accounts_ready']==result['active_account_target']==4
    assert result['future_account_slots']==3 and result['cohort_limit']==7
    assert result['active_cohort']=={'checked':True,'members':4,'matches_active_roster':True}
    assert 'incomplete_roster' not in result['blockers']
    assert 'active_roster_slots_missing' not in result['blockers']
    assert result['result']=='NOT_READY'  # Financial evidence is still required.
    assert not result['release_authorized'] and not result['spending_authorized']
    assert all(tester['user_id'] is None for tester in manifest['testers'][4:])
    assert cohort.read_bytes()==before
    output=json.dumps(result)
    assert all(tester['user_id'] not in output for tester in manifest['testers'][:4])


def test_expanding_to_seven_requires_new_verified_accounts_and_matching_cohort(launch_plan,tmp_path):
    manifest=ready_manifest();cohort=private_cohort(tmp_path,manifest,{1,2,3,4})
    reviewed(launch_plan);launch_plan['active_slots']=list(range(1,8))
    result=assess(encoded(manifest),launch_plan=encoded(launch_plan),cohort=cohort)
    assert result['active_account_target']==7 and result['future_account_slots']==0
    assert 'active_cohort_roster_mismatch' in result['blockers']
    assert not result['active_cohort']['matches_active_roster']
    assert not result['spending_authorized']


def test_future_account_in_paid_cohort_blocks_initial_four_even_when_account_exists(launch_plan,tmp_path):
    manifest=ready_manifest();cohort=private_cohort(tmp_path,manifest,{1,2,3,4,5})
    result=assess(encoded(manifest),launch_plan=encoded(reviewed(launch_plan)),cohort=cohort)
    assert 'active_cohort_roster_mismatch' in result['blockers']
    assert result['active_accounts_ready']==4 and result['future_account_slots']==3


def test_active_plan_without_explicit_cohort_check_remains_pending(launch_plan):
    result=assess(encoded(staged_manifest()),launch_plan=encoded(reviewed(launch_plan)))
    assert 'active_cohort_not_checked' in result['blockers']
    assert result['active_cohort']=={'checked':False,'matches_active_roster':False}


def test_adding_unknown_future_slot_does_not_invent_a_ready_identity(launch_plan):
    reviewed(launch_plan);launch_plan['active_slots']=[1,2,3,4,5]
    result=assess(encoded(staged_manifest()),launch_plan=encoded(launch_plan))
    assert result['active_accounts_ready']==4 and result['active_account_target']==5
    assert 'incomplete_roster' in result['blockers']


def test_launch_api_origin_must_match_manifest_distribution_without_printing_urls(launch_plan):
    reviewed(launch_plan);launch_plan['destinations']['api_origin']='https://different.example.com'
    result=assess(encoded(ready_manifest()),launch_plan=encoded(launch_plan))
    assert 'launch_plan_api_origin_mismatch' in result['blockers']
    assert 'https://different.example.com' not in json.dumps(result)


def test_mobile_web_plan_does_not_certify_a_native_distribution(launch_plan):
    manifest=ready_manifest();manifest['distribution']['kind']='native_beta'
    result=assess(encoded(manifest),launch_plan=encoded(reviewed(launch_plan)))
    assert 'launch_plan_mobile_web_distribution_required' in result['blockers']


@pytest.mark.parametrize('slots',[[],[1],[1,1,2],[1,2,8],[True,2],[1,2,3,4,5,6,7,8],'1,2,3,4'])
def test_active_slots_are_bounded_unique_and_never_account_identifiers(launch_plan,slots):
    reviewed(launch_plan);launch_plan['active_slots']=slots
    with pytest.raises(PreflightError):assess_launch_plan(encoded(launch_plan))


def test_private_cohort_validation_failure_has_no_path_or_identity_leak(launch_plan,tmp_path,capsys):
    manifest=staged_manifest();folder=tmp_path/'private';folder.mkdir(mode=0o700)
    roster=folder/'pilot.json';roster.write_bytes(encoded(manifest));roster.chmod(0o600)
    plan=folder/'launch.json';plan.write_bytes(encoded(reviewed(launch_plan)));plan.chmod(0o600)
    cohort=private_cohort(tmp_path,manifest,{1,2,3,4});cohort.chmod(0o644)
    assert main(['--manifest',str(roster),'--launch-plan',str(plan),'--cohort',str(cohort)])==2
    output=capsys.readouterr().out
    assert str(cohort) not in output
    assert all(tester['user_id'] not in output for tester in manifest['testers'][:4])
    assert json.loads(output)['result']=='INVALID_OR_UNSAFE_INPUT'
