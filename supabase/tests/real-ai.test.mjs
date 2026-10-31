import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');

// SQL role claims in disposable PostgreSQL, not hosted JWT/device/provider proof.
const A='ad290000-0000-4000-8000-000000000001', B='ad290000-0000-4000-8000-000000000002';
const PA='bd290000-0000-4000-8000-000000000001', PB='bd290000-0000-4000-8000-000000000002';
const SA='cd290000-0000-4000-8000-000000000001', SB='cd290000-0000-4000-8000-000000000002';
const hash='a'.repeat(64);
const provenance={mode:'real',provider:'openai',model:'provider-fixture',version:1};
async function setup() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT COALESCE(
      nullif(current_setting('request.jwt.claim.sub',true),'')::uuid,
      (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for (const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=(await readFile(new URL(name,dir),'utf8')).replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm,'');
    try { await db.exec(sql); } catch(error) { throw new Error(`Migration failed: ${name}`,{cause:error}); }
  }
  await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)',[A,'real-a@example.invalid',B,'real-b@example.invalid']);
  await db.query('INSERT INTO public.books(id,user_id,title,language) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',[PA,A,'English fixture','en',PB,B,'Svensk test','sv']);
  await db.query('INSERT INTO public.conversation_sessions(id,project_id,language) VALUES ($1,$2,$3),($4,$5,$6)',[SA,PA,'en',SB,PB,'sv']);
  return db;
}
async function role(db,name,owner,fn) {
  await db.exec(`SET ROLE ${name}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner??'']);
  try { return await fn(); } finally { await db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
}
const user=(db,id,fn)=>role(db,'authenticated',id,fn);
const server=(db,fn)=>role(db,'service_role',null,fn);
async function rpc(db,name,args,types) {
  return (await db.query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}::${types[i]}`).join(',')}) AS result`,args)).rows[0].result;
}
const claim=(db,kind='transcription',key=randomUUID(),owner=A,project=PA,session=SA,requestHash=null)=>server(db,()=>rpc(db,'claim_real_ai_operation',[owner,project,session,kind,key,requestHash??(kind==='conversation'?createHash('sha256').update(key).digest('hex'):hash)],['uuid','uuid','uuid','text','uuid','text']));
const complete=(db,op,result,owner=A,prov=provenance)=>server(db,()=>rpc(db,'complete_real_ai_operation',[owner,op.operation_id,op.claim_token,result,prov],['uuid','uuid','uuid','jsonb','jsonb']));
const fail=(db,op,uncertain=true,code='PROVIDER_UNKNOWN')=>server(db,()=>rpc(db,'fail_real_ai_operation',[A,op.operation_id,op.claim_token,code,uncertain],['uuid','uuid','uuid','text','boolean']));
const context=(db,owner=A,project=PA)=>user(db,owner,()=>rpc(db,'get_real_story_context',[project],['uuid']));
const review=(db,id,version,status='confirmed',correction=null,owner=A)=>user(db,owner,()=>rpc(db,'review_real_memory',[id,version,status,correction],['uuid','integer','text','text']));
const edit=(db,id,version,content,owner=A)=>user(db,owner,()=>rpc(db,'edit_real_story_draft',[id,version,content],['uuid','integer','text']));
const errorCode=code=>error=>error.code===code;
async function transcript(db,text='I moved to Malmö in 1975.',owner=A,project=PA,session=SA) {
  const op=await claim(db,'transcription',randomUUID(),owner,project,session);
  return complete(db,op,{text},owner);
}
async function turn(db,tr,memories=[],owner=A,project=PA,session=SA) {
  const op=await claim(db,'conversation',randomUUID(),owner,project,session);
  return complete(db,op,{source_transcript_id:tr.transcript_id,assistant_text:'Tell me more about that memory.',memories},owner);
}

test('real AI local persistence trust boundary and source lifecycle',async t=>{
  const db=await setup();
  let tr,conversation,otherConversation,draft;
  try {
    await t.test('only server role may claim or complete, and no client can read nonces or forge writes',async()=>{
      const signatures=['claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text)','complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb)','fail_real_ai_operation(uuid,uuid,uuid,text,boolean)'];
      for(const signature of signatures) {
        const rows=(await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS client,has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('service_role',$1,'EXECUTE') AS server",[`public.${signature}`])).rows[0];
        assert.deepEqual(rows,{client:false,anon:false,server:true});
      }
      await assert.rejects(()=>user(db,A,()=>db.query('SELECT * FROM public.real_ai_operations')),errorCode('42501'));
      await assert.rejects(()=>user(db,A,()=>rpc(db,'claim_real_ai_operation',[A,PA,SA,'transcription',randomUUID(),hash],['uuid','uuid','uuid','text','uuid','text'])),errorCode('42501'));
      for (const table of ['real_transcripts','real_conversation_messages','real_memories','real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports']) {
        await assert.rejects(()=>user(db,A,()=>db.exec(`INSERT INTO public.${table} DEFAULT VALUES`)),errorCode('42501'));
        await assert.rejects(()=>user(db,A,()=>db.exec(`UPDATE public.${table} SET owner_id=owner_id`)),errorCode('42501'));
        await assert.rejects(()=>user(db,A,()=>db.exec(`DELETE FROM public.${table}`)),errorCode('42501'));
        await assert.rejects(()=>role(db,'anon',null,()=>db.query(`SELECT * FROM public.${table}`)),errorCode('42501'));
      }
    });

    await t.test('claim only yields nonce once; payload/context mismatch conflicts; terminal failure never reclaims',async()=>{
      const key=randomUUID(),first=await claim(db,'transcription',key);
      assert.equal(first.claimed,true); assert.ok(first.claim_token);
      const retry=await claim(db,'transcription',key);
      assert.equal(retry.claimed,false); assert.equal(retry.status,'in_progress'); assert.equal(retry.claim_token,undefined);
      await assert.rejects(()=>claim(db,'transcription',key,A,PA,SA,'b'.repeat(64)),errorCode('40001'));
      const otherSession=randomUUID();
      await db.query("INSERT INTO public.conversation_sessions(id,project_id,language) VALUES($1,$2,'en')",[otherSession,PA]);
      await assert.rejects(()=>claim(db,'transcription',key,A,PA,otherSession),errorCode('40001'));
      await assert.rejects(()=>claim(db,'transcription',randomUUID(),A,PB,SB),errorCode('P0002'));
      await assert.rejects(()=>claim(db,'transcription',randomUUID(),A,PA,SB),errorCode('P0002'));
      await assert.rejects(()=>complete(db,{...first,claim_token:randomUUID()},{text:'No'}),errorCode('42501'));
      await fail(db,first);
      const stopped=await claim(db,'transcription',key);
      assert.equal(stopped.status,'uncertain'); assert.equal(stopped.claimed,false); assert.equal(stopped.claim_token,undefined);
      await assert.rejects(()=>complete(db,first,{text:'No silent repaid retry'}),errorCode('40001'));
      const knownFailure=await claim(db); await fail(db,knownFailure,false);
      const status=await user(db,A,()=>rpc(db,'get_real_ai_operation',[knownFailure.operation_id],['uuid']));
      assert.equal(status.status,'failed'); assert.equal(status.claim_token,undefined);
      assert.deepEqual(Object.keys(status).sort(),['operation_id','kind','status','project_id','session_id','created_at','updated_at','error_code','result'].sort());
      await assert.rejects(()=>user(db,B,()=>rpc(db,'get_real_ai_operation',[knownFailure.operation_id],['uuid'])),errorCode('P0002'));
    });

    await t.test('authenticated action-key reconciliation is an owned read and never returns a claim nonce',async()=>{
      const key=randomUUID(),operation=await claim(db,'transcription',key);
      const find=(owner=A,kind='transcription',actionKey=key)=>user(db,owner,()=>rpc(db,'get_real_ai_operation_by_key',[kind,actionKey],['text','uuid']));
      const before=(await db.query('SELECT to_jsonb(o) AS row FROM public.real_ai_operations o WHERE operation_id=$1',[operation.operation_id])).rows[0].row;
      const recovered=await find();
      assert.equal(recovered.operation_id,operation.operation_id); assert.equal(recovered.status,'in_progress');
      assert.equal(recovered.result,null); assert.equal(recovered.claim_token,undefined); assert.equal(recovered.owner_id,undefined);
      assert.deepEqual(Object.keys(recovered).sort(),['operation_id','kind','status','project_id','session_id','created_at','updated_at','error_code','result'].sort());
      assert.deepEqual(recovered,await user(db,A,()=>rpc(db,'get_real_ai_operation',[operation.operation_id],['uuid'])));
      assert.deepEqual((await db.query('SELECT to_jsonb(o) AS row FROM public.real_ai_operations o WHERE operation_id=$1',[operation.operation_id])).rows[0].row,before);
      await assert.rejects(()=>find(B),errorCode('P0002'));
      await assert.rejects(()=>find(A,'conversation'),errorCode('P0002'));
      await assert.rejects(()=>find(A,'transcription',randomUUID()),errorCode('P0002'));
      await assert.rejects(()=>role(db,'anon',null,()=>rpc(db,'get_real_ai_operation_by_key',['transcription',key],['text','uuid'])),errorCode('42501'));
      await fail(db,operation,false,'AI_APPROVAL_REQUIRED');
      assert.equal((await find()).status,'failed');
      assert.equal((await find()).claim_token,undefined);
    });

    await t.test('transcripts stay immutable, accurately linked and explicitly real with whitelisted provenance',async()=>{
      const op=await claim(db);
      for(const invalid of [{...provenance,mode:'mock'},{...provenance,provider:'unknown'},{...provenance,version:2},{...provenance,model:''}])
        await assert.rejects(()=>complete(db,op,{text:'Original'},A,invalid),errorCode('22023'));
      tr=await complete(db,op,{text:'I moved to Malmö in 1975.'},A,{...provenance,private_ignored_field:'never stored'});
      assert.equal(tr.language,'en'); assert.equal(tr.status,'completed'); assert.deepEqual(tr.provenance,provenance);
      assert.equal(tr.owner_id,undefined); assert.equal(tr.operation_id,undefined);
      assert.deepEqual(await complete(db,op,{text:'Changed on replay'}),tr);
      const replay=await user(db,A,()=>rpc(db,'get_real_ai_operation',[op.operation_id],['uuid']));
      assert.deepEqual(replay.result,tr); assert.equal(replay.claim_token,undefined);
      assert.equal((await user(db,A,()=>db.query('SELECT transcript_id FROM public.real_transcripts'))).rows.length,1);
      assert.equal((await user(db,B,()=>db.query('SELECT transcript_id FROM public.real_transcripts'))).rows.length,0);
      await assert.rejects(()=>db.query("UPDATE public.real_transcripts SET text='Overwritten' WHERE transcript_id=$1",[tr.transcript_id]),errorCode('55000'));
    });

    await t.test('one transcript digest cannot claim a second paid reply under a different action key',async()=>{
      const digest='d'.repeat(64),key=randomUUID();
      const claimed=await claim(db,'conversation',key,A,PA,SA,digest);
      await assert.rejects(()=>claim(db,'conversation',randomUUID(),A,PA,SA,digest),errorCode('40001'));
      const replay=await claim(db,'conversation',key,A,PA,SA,digest);
      assert.equal(replay.claimed,false); assert.equal(replay.claim_token,undefined);
      await fail(db,claimed,true);
      await assert.rejects(()=>claim(db,'conversation',randomUUID(),A,PA,SA,digest),errorCode('40001'));
      assert.equal((await claim(db,'conversation',key,A,PA,SA,digest)).status,'uncertain');
      const failedDigest='e'.repeat(64),failed=await claim(db,'conversation',randomUUID(),A,PA,SA,failedDigest);
      await fail(db,failed,false,'AI_APPROVAL_REQUIRED');
      const explicitRetry=await claim(db,'conversation',randomUUID(),A,PA,SA,failedDigest);
      assert.equal(explicitRetry.claimed,true); assert.notEqual(explicitRetry.operation_id,failed.operation_id);
      await assert.rejects(()=>complete(db,failed,{source_transcript_id:tr.transcript_id,
        assistant_text:'The failed original key cannot be retried.',memories:[]}),errorCode('40001'));
      await fail(db,explicitRetry,true);
      await assert.rejects(()=>claim(db,'conversation',randomUUID(),A,PA,SA,failedDigest),errorCode('40001'));
      // SQL fixtures represent trusted server dispatch-trace decisions. These
      // do not independently prove that the real provider was never called.
      for (const code of ['AI_RATE_LIMIT','AI_INPUT_LIMIT']) {
        const preflightDigest=createHash('sha256').update(code).digest('hex');
        const noDispatch=await claim(db,'conversation',randomUUID(),A,PA,SA,preflightDigest);
        await fail(db,noDispatch,false,code);
        const next=await claim(db,'conversation',randomUUID(),A,PA,SA,preflightDigest);
        assert.equal(next.claimed,true); assert.notEqual(next.operation_id,noDispatch.operation_id);
        await fail(db,next,true);
      }
    });

    await t.test('conversation completion is atomic, requires exact source evidence and cannot reuse another tenant transcript',async()=>{
      const conversationKey=randomUUID(),conversationDigest='c'.repeat(64);
      const op=await claim(db,'conversation',conversationKey,A,PA,SA,conversationDigest);
      await assert.rejects(()=>complete(db,op,{source_transcript_id:tr.transcript_id,assistant_text:'Question',memories:[{fact_type:'location',value:'London',evidence:'Invented'}]}),errorCode('22023'));
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.real_conversation_messages')).rows[0].count,0);
      const sv=await transcript(db,'Jag bodde i Stockholm 1980.',B,PB,SB);
      await assert.rejects(()=>complete(db,op,{source_transcript_id:sv.transcript_id,assistant_text:'Question',memories:[]}),errorCode('P0002'));
      conversation=await complete(db,op,{source_transcript_id:tr.transcript_id,assistant_text:'What do you remember about Malmö?',memories:[
        {fact_type:'location',value:'Malmö',evidence:'Malmö',slot:'home'},
        {fact_type:'date',value:'1975',evidence:'1975',year:1975,uncertain:true,clarification_question:'Is 1975 the correct year?'}]});
      assert.equal(conversation.mode,'real'); assert.equal(conversation.user_message.id,tr.transcript_id);
      assert.equal(conversation.user_message.text,tr.text); assert.equal(conversation.user_message.sequence,1);
      assert.equal(conversation.message.sequence,2); assert.equal(conversation.memories.length,2);
      assert.ok(conversation.memories.every(m=>m.status==='pending'&&m.version===1));
      assert.equal(conversation.requires_clarification,true);
      assert.equal(conversation.clarifications[0].status,'open');
      await assert.rejects(()=>claim(db,'conversation',randomUUID(),A,PA,SA,conversationDigest),errorCode('40001'));
      assert.deepEqual((await claim(db,'conversation',conversationKey,A,PA,SA,conversationDigest)).result,conversation);
      const duplicate=await claim(db,'conversation');
      await assert.rejects(()=>complete(db,duplicate,{source_transcript_id:tr.transcript_id,assistant_text:'Again',memories:[]}),errorCode('40001'));
      otherConversation=await turn(db,sv,[{fact_type:'location',value:'Stockholm',evidence:'Stockholm'}],B,PB,SB);
      assert.equal(otherConversation.message.language,'sv'); assert.equal(otherConversation.message.session_id,SB);
      for(const table of ['real_transcripts','real_conversation_messages','real_memories','real_memory_clarifications']) {
        assert.ok((await user(db,A,()=>db.query(`SELECT owner_id,project_id,session_id FROM public.${table}`))).rows.every(r=>r.owner_id===A&&r.project_id===PA&&r.session_id===SA));
        assert.ok((await user(db,B,()=>db.query(`SELECT owner_id,project_id,session_id FROM public.${table}`))).rows.every(r=>r.owner_id===B&&r.project_id===PB&&r.session_id===SB));
      }
      await assert.rejects(()=>db.query("UPDATE public.real_conversation_messages SET text='Changed' WHERE id=$1",[conversation.message.id]),errorCode('55000'));
    });

    await t.test('explicit memory review is owned, versioned, replay safe and preserves original evidence',async()=>{
      const [location,date]=conversation.memories;
      await assert.rejects(()=>review(db,location.id,1,'confirmed',null,B),errorCode('P0002'));
      await assert.rejects(()=>review(db,location.id,1,'pending'),errorCode('22023'));
      await assert.rejects(()=>review(db,location.id,1,'rejected','Correction'),errorCode('22023'));
      const confirmed=await review(db,location.id,1);
      assert.equal(confirmed.version,2); assert.equal(confirmed.value,'Malmö');
      assert.deepEqual(await review(db,location.id,1),confirmed);
      await assert.rejects(()=>review(db,location.id,1,'rejected'),errorCode('40001'));
      const corrected=await review(db,date.id,1,'confirmed','1976');
      assert.equal(corrected.value,'1975'); assert.equal(corrected.evidence,'1975'); assert.equal(corrected.corrected_value,'1976');
      assert.equal((await db.query('SELECT status FROM public.real_memory_clarifications WHERE fact_id=$1',[date.id])).rows[0].status,'resolved');
      assert.equal((await user(db,A,()=>db.query('SELECT count(*)::integer AS count FROM public.real_memory_revisions'))).rows[0].count,2);
      assert.equal((await user(db,B,()=>db.query('SELECT count(*)::integer AS count FROM public.real_memory_revisions'))).rows[0].count,0);
      await assert.rejects(()=>db.query("UPDATE public.real_memories SET value='Invented' WHERE id=$1",[location.id]),errorCode('55000'));
      await assert.rejects(()=>db.exec("UPDATE public.real_memory_revisions SET status='rejected'"),errorCode('55000'));
      const c=await context(db); assert.equal(c.confirmed_count,2); assert.equal(c.blocking_clarifications.length,0); assert.match(c.context_token,/^[a-f0-9]{64}$/);
      await assert.rejects(()=>context(db,B,PA),errorCode('P0002'));
    });

    await t.test('real drafts use reviewed current source snapshots and can never inherit deterministic mock verification',async()=>{
      const op=await claim(db,'generation',randomUUID(),A,PA,null), c=await context(db);
      const input={content:'I moved to Malmö. The year needs my personal review.',source_memories:c.source_memories,model_review:{unsupported_claims:[],status:'passed',method:'deterministic_mock_v1'}};
      await assert.rejects(()=>complete(db,op,{...input,source_memories:[]}),errorCode('40001'));
      await assert.rejects(()=>complete(db,op,{...input,model_review:null}),errorCode('22023'));
      draft=await complete(db,op,input);
      assert.equal(draft.status,'needs_review'); assert.equal(draft.mode,'real'); assert.equal(draft.revision,1); assert.equal(draft.version,1);
      assert.equal(draft.verification.status,'needs_review'); assert.equal(draft.verification.method,'model_review_v1');
      assert.deepEqual(draft.source_memories,c.source_memories); assert.deepEqual(draft.provenance,provenance);
      assert.equal((await user(db,B,()=>db.query('SELECT * FROM public.real_story_drafts'))).rows.length,0);
      await assert.rejects(()=>db.query("UPDATE public.real_story_drafts SET original_content='Fake' WHERE draft_id=$1",[draft.draft_id]),errorCode('55000'));
      const staleOp=await claim(db,'generation',randomUUID(),A,PA,null);
      await review(db,conversation.memories[0].id,2,'confirmed','Göteborg');
      await assert.rejects(()=>complete(db,staleOp,input),errorCode('40001'));
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.real_story_drafts')).rows[0].count,1);
    });

    await t.test('manual draft edits keep original/sources, require review, record audit and reject stale/cross-user requests',async()=>{
      await assert.rejects(()=>edit(db,draft.draft_id,1,'Changed',B),errorCode('P0002'));
      const revised=await edit(db,draft.draft_id,1,'My own correction of this story.');
      assert.equal(revised.status,'edited'); assert.equal(revised.revision,2); assert.equal(revised.original_content,draft.original_content);
      assert.deepEqual(revised.source_memories,draft.source_memories); assert.equal(revised.verification.method,'manual_unverified');
      assert.equal(revised.verification.status,'needs_review'); assert.equal(revised.verification.checked_revision,2);
      assert.deepEqual(await edit(db,draft.draft_id,1,revised.content),revised);
      await assert.rejects(()=>edit(db,draft.draft_id,1,'Different stale edit'),errorCode('40001'));
      const audit=(await user(db,A,()=>db.query('SELECT revision,previous_content,content FROM public.real_story_edits'))).rows;
      assert.deepEqual(audit,[{revision:2,previous_content:draft.content,content:revised.content}]);
      assert.equal((await user(db,B,()=>db.query('SELECT * FROM public.real_story_edits'))).rows.length,0);
      await assert.rejects(()=>db.exec("UPDATE public.real_story_edits SET content='Changed'"),errorCode('55000'));
    });

    await t.test('speech persists only bounded transient metadata for an owned assistant reply',async()=>{
      const op=await claim(db,'speech'), payload={assistant_message_id:conversation.message.id,media_type:'audio/wav',audio_sha256:hash,audio_size:1024,expires_at:new Date(Date.now()+300000).toISOString()};
      await assert.rejects(()=>complete(db,op,{...payload,assistant_message_id:conversation.user_message.id}),errorCode('P0002'));
      await assert.rejects(()=>complete(db,op,{...payload,assistant_message_id:otherConversation.message.id}),errorCode('P0002'));
      await assert.rejects(()=>complete(db,op,{...payload,expires_at:new Date(Date.now()-10000).toISOString()}),errorCode('22023'));
      await assert.rejects(()=>complete(db,op,{...payload,audio_size:8000001}),errorCode('23514'));
      const speech=await complete(db,op,payload); assert.equal(speech.assistant_message_id,conversation.message.id); assert.equal(speech.audio_size,1024);
      const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='real_speech'")).rows.map(r=>r.column_name);
      assert.ok(!columns.some(c=>/url|audio_bytes|audio_data|base64/.test(c)));
      assert.equal((await user(db,B,()=>db.query('SELECT * FROM public.real_speech'))).rows.length,0);
    });

    await t.test('real PDF audits preserve exact owned revision and historical content without paid operations',async()=>{
      const args=[draft.draft_id,2,'English fixture',true,true,2,1024,'memy-english-fixture.pdf','memy_real_pdf_v1'];
      const types=['uuid','integer','text','boolean','boolean','integer','integer','text','text'];
      const record=(values=args,owner=A)=>user(db,owner,()=>rpc(db,'record_real_story_export',values,types));
      await assert.rejects(()=>record(args,B),errorCode('P0002'));
      await assert.rejects(()=>record([...args.slice(0,1),1,...args.slice(2)]),errorCode('40001'));
      await assert.rejects(()=>record([...args.slice(0,2),'Stale title',...args.slice(3)]),errorCode('40001'));
      await assert.rejects(()=>record([...args.slice(0,7),'../../unsafe.pdf',args[8]]),errorCode('22023'));
      const opCount=(await db.query('SELECT count(*)::integer AS count FROM public.real_ai_operations')).rows[0].count;
      const metadata=await record(); assert.equal(metadata.draft_revision,2); assert.equal(metadata.draft_version,1);
      assert.equal(metadata.content,undefined); assert.equal(metadata.owner_id,undefined); assert.equal(metadata.format,'pdf');
      assert.deepEqual(await record(),metadata);
      const saved=await user(db,A,()=>rpc(db,'get_real_story_export',[metadata.export_id],['uuid']));
      assert.equal(saved.content,'My own correction of this story.'); assert.deepEqual(saved.export,metadata);
      await edit(db,draft.draft_id,2,'Later revised content.');
      assert.deepEqual(await user(db,A,()=>rpc(db,'get_real_story_export',[metadata.export_id],['uuid'])),saved);
      await assert.rejects(()=>user(db,B,()=>rpc(db,'get_real_story_export',[metadata.export_id],['uuid'])),errorCode('P0002'));
      assert.equal((await user(db,B,()=>db.query('SELECT * FROM public.real_story_exports'))).rows.length,0);
      assert.equal((await db.query('SELECT count(*)::integer AS count FROM public.real_ai_operations')).rows[0].count,opCount);
      await assert.rejects(()=>db.exec("UPDATE public.real_story_exports SET content='Changed'"),errorCode('55000'));
    });

    await t.test('conflicting memory decisions cannot leave two confirmed alternatives or re-open an obsolete claim',async()=>{
      const source=await transcript(db,'I lived in Uppsala.');
      const old=conversation.memories[0],next=await turn(db,source,[{fact_type:'location',value:'Uppsala',evidence:'Uppsala',
        conflicts_with_fact_id:old.id,clarification_question:'Which location should be used?'}]);
      const replacement=next.memories[0];
      await assert.rejects(()=>review(db,replacement.id,1),errorCode('40001'));
      await review(db,old.id,3,'rejected');
      await review(db,replacement.id,1);
      await assert.rejects(()=>review(db,old.id,4),errorCode('40001'));
      assert.equal((await context(db)).blocking_clarifications.length,0);
    });

    await t.test('completed/deleted project guards cannot be bypassed; new real records leave mock tables untouched',async()=>{
      const late=await claim(db);
      const replayKey=randomUUID(),finished=await claim(db,'transcription',replayKey);
      const finishedResult=await complete(db,finished,{text:'A completed source remains replayable.'});
      await db.query("UPDATE public.conversation_sessions SET status='completed',ended_at=now() WHERE id=$1",[SA]);
      await assert.rejects(()=>complete(db,late,{text:'After completed session'}),errorCode('40001'));
      await assert.rejects(()=>claim(db),errorCode('40001'));
      const replay=await claim(db,'transcription',replayKey);
      assert.equal(replay.claimed,false); assert.equal(replay.status,'completed'); assert.deepEqual(replay.result,finishedResult);
      await db.query('UPDATE public.books SET is_deleted=true WHERE id=$1',[PA]);
      for(const table of ['real_transcripts','real_conversation_messages','real_memories','real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports'])
        assert.equal((await user(db,A,()=>db.query(`SELECT * FROM public.${table}`))).rows.length,0);
      await assert.rejects(()=>context(db),errorCode('P0002'));
      for(const table of ['conversation_messages','memory_facts','story_drafts','story_edit_history'])
        assert.equal((await db.query(`SELECT count(*)::integer AS count FROM public.${table}`)).rows[0].count,0,table);
      await db.query('DELETE FROM public.books WHERE id=$1',[PA]);
      for(const table of ['real_ai_operations','real_transcripts','real_conversation_messages','real_memories','real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports'])
        assert.equal((await db.query(`SELECT count(*)::integer AS count FROM public.${table} WHERE project_id=$1`,[PA])).rows[0].count,0,table);
      assert.equal((await user(db,B,()=>db.query('SELECT * FROM public.real_conversation_messages'))).rows.length,2);
    });
  } finally { await db.close(); }
});

test('exact hosted real-AI SQL fixture is rollback-only and emits sanitized scoped evidence',async()=>{
  const db=await setup();
  try {
    const sql=await readFile(new URL('./cloud-real-ai.sql',import.meta.url),'utf8');
    assert.match(sql,/^BEGIN;$/m); assert.match(sql,/^ROLLBACK;$/m); assert.doesNotMatch(sql,/^COMMIT;$/m);
    assert.doesNotMatch(sql,/\b(?:net\.http_|http_post|http_get|cron\.schedule)\b/i);
    const before=(await db.query("SELECT jsonb_build_object('users',(SELECT count(*) FROM auth.users),'books',(SELECT count(*) FROM public.books),'profiles',(SELECT count(*) FROM public.profiles),'settings',(SELECT count(*) FROM public.user_settings)) AS counts")).rows[0].counts;
    const results=await db.exec(sql),report=results.at(-1).rows[0];
    assert.equal(report.real_ai_security,'PASS');
    assert.equal(report.identity_scope,'SQL ROLE CLAIMS ONLY');
    assert.equal(report.provider_scope,'SCRIPTED SQL ONLY; NO PROVIDER CALLS');
    assert.equal(report.two_way_owner_isolation,'PASS'); assert.equal(report.source_immutability,'PASS');
    assert.equal(report.memory_review_and_draft_history,'PASS'); assert.equal(report.action_key_recovery,'PASS');
    assert.equal(report.service_only_completion,'PASS'); assert.equal(report.synthetic_data,'ROLLED BACK');
    assert.equal(report.pdf_scope,'METADATA ONLY'); assert.equal(report.speech_scope,'METADATA ONLY; NO AUDIO');
    assert.equal(report.real_auth_jwt_test,'NOT RUN'); assert.equal(report.physical_phone_test,'NOT RUN');
    assert.deepEqual((await db.query("SELECT jsonb_build_object('users',(SELECT count(*) FROM auth.users),'books',(SELECT count(*) FROM public.books),'profiles',(SELECT count(*) FROM public.profiles),'settings',(SELECT count(*) FROM public.user_settings)) AS counts")).rows[0].counts,before);
    for(const table of ['real_ai_operations','real_transcripts','real_conversation_messages','real_memories',
      'real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports'])
      assert.equal((await db.query(`SELECT count(*)::integer AS count FROM public.${table}`)).rows[0].count,0,table);
    assert.equal((await db.query('SELECT current_user AS role')).rows[0].role,'postgres');
    assert.equal((await db.query("SELECT nullif(current_setting('request.jwt.claim.sub',true),'') AS claim")).rows[0].claim,null);
  } finally { await db.close(); }
});
