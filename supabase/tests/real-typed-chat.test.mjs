import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
const {PGlite}=createRequire(import.meta.url)('@electric-sql/pglite');

// Disposable PostgreSQL role fixtures only: no hosted JWT, real provider or phone.
const A='a1103000-0000-4000-8000-000000000001',B='a1103000-0000-4000-8000-000000000002';
const PA='b1103000-0000-4000-8000-000000000001',PB='b1103000-0000-4000-8000-000000000002';
const SA='c1103000-0000-4000-8000-000000000001',SB='c1103000-0000-4000-8000-000000000002';
const provider={mode:'real',provider:'openai',model:'offline-sql-fixture',version:1};
const original={mode:'original',provider:'user',model:null,version:1};
const typedMigration='20261103010000_real_typed_chat.sql';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const errorCode=code=>error=>error.code===code;
async function role(db,name,owner,fn){
  await db.exec(`SET ROLE ${name}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner??'']);
  try{return await fn();}finally{await db.exec('RESET ROLE; RESET request.jwt.claim.sub');}
}
const user=(db,id,fn)=>role(db,'authenticated',id,fn);
const server=(db,fn)=>role(db,'service_role',null,fn);
async function rpc(db,name,args,types){
  return (await db.query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}::${types[i]}`).join(',')}) AS result`,args)).rows[0].result;
}
const claim=(db,{kind='conversation',key=randomUUID(),owner=A,project=PA,session=SA,hash=digest(key)}={})=>server(db,()=>rpc(db,'claim_real_ai_operation',
  [owner,project,session,kind,key,hash],['uuid','uuid','uuid','text','uuid','text']));
const complete=(db,op,result,owner=A,provenance=provider)=>server(db,()=>rpc(db,'complete_real_ai_operation',
  [owner,op.operation_id,op.claim_token,result,provenance],['uuid','uuid','uuid','jsonb','jsonb']));
const scope=(db,owner=A,session=SA)=>user(db,owner,()=>rpc(db,'check_real_text_chat_scope',[session],['uuid']));
const sources=(db,ids,owner=A,session=SA)=>user(db,owner,()=>rpc(db,'get_real_text_chat_sources',[session,ids],['uuid','uuid[]']));
async function typed(db,text,options={}){
  const op=await claim(db,options);
  return {op,turn:await complete(db,op,{input_text:text,assistant_text:options.assistant??'What do you remember?',memories:options.memories??[]},options.owner??A)};
}
async function voice(db,text='I remember Malmö.',options={}){
  const trOp=await claim(db,{...options,kind:'transcription'});
  const tr=await complete(db,trOp,{text},options.owner??A);
  const op=await claim(db,options);
  const turn=await complete(db,op,{source_transcript_id:tr.transcript_id,assistant_text:'Tell me more.',memories:[]},options.owner??A);
  return {op,tr,turn};
}
async function setup(){
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
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')&&n!==typedMigration).sort()){
    const sql=(await readFile(new URL(name,dir),'utf8')).replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm,'');
    try{await db.exec(sql);}catch(error){throw new Error(`Migration failed: ${name}`,{cause:error});}
  }
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)',[A,'typed-a@example.invalid',B,'typed-b@example.invalid']);
  await db.query('INSERT INTO public.books(id,user_id,title,language) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[PA,A,'English fixture','en',PB,B,'Svenska minnen','sv']);
  await db.query('INSERT INTO public.conversation_sessions(id,project_id,language) VALUES($1,$2,$3),($4,$5,$6)',[SA,PA,'en',SB,PB,'sv']);
  const legacy=await voice(db);
  assert.equal('source_text_input_id' in legacy.turn.user_message,false);
  const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='real_conversation_messages' ORDER BY ordinal_position")).rows;
  await db.exec(await readFile(new URL(typedMigration,dir),'utf8'));
  return {db,legacy,columns};
}

test('typed originals and existing voice share an owned immutable conversation lifecycle',async t=>{
  const {db,legacy,columns}=await setup();
  let english,swedish;
  try{
    await t.test('existing voice columns and completed result remain byte-for-byte compatible',async()=>{
      assert.deepEqual((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='real_conversation_messages' ORDER BY ordinal_position")).rows,columns);
      const row=(await user(db,A,()=>db.query('SELECT * FROM public.real_conversation_messages WHERE id=$1',[legacy.turn.user_message.id]))).rows[0];
      assert.equal('source_text_input_id' in row,false);
      assert.deepEqual(await complete(db,legacy.op,{input_text:'Do not replace old results'}),legacy.turn);
      const replay=await user(db,A,()=>rpc(db,'get_real_ai_operation',[legacy.op.operation_id],['uuid']));
      assert.deepEqual(replay.result,legacy.turn);assert.equal(replay.claim_token,undefined);
    });

    await t.test('client/server direct writes remain revoked; only authenticated owned reads and narrow RPCs exist',async()=>{
      for(const name of ['anon','authenticated','service_role']){
        const owner=name==='authenticated'?A:null;
        for(const statement of ['INSERT INTO public.real_text_inputs DEFAULT VALUES','UPDATE public.real_text_inputs SET text=text','DELETE FROM public.real_text_inputs'])
          await assert.rejects(()=>role(db,name,owner,()=>db.exec(statement)),errorCode('42501'));
      }
      await assert.rejects(()=>role(db,'anon',null,()=>db.exec('SELECT * FROM public.real_text_inputs')),errorCode('42501'));
      for(const signature of ['check_real_text_chat_scope(uuid)','get_real_text_chat_sources(uuid,uuid[])']){
        const grants=(await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS auth,has_function_privilege('anon',$1,'EXECUTE') AS anon",['public.'+signature])).rows[0];
        assert.deepEqual(grants,{auth:true,anon:false});
      }
      for(const signature of ['claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text)','complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb)','fail_real_ai_operation(uuid,uuid,uuid,text,boolean)']){
        const grants=(await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS auth,has_function_privilege('anon',$1,'EXECUTE') AS anon,has_function_privilege('service_role',$1,'EXECUTE') AS server",['public.'+signature])).rows[0];
        assert.deepEqual(grants,{auth:false,anon:false,server:true});
      }
    });

    await t.test('content-free deployment preflight checks ownership, language and active session before a paid claim',async()=>{
      assert.deepEqual(await scope(db),{project_id:PA,session_id:SA,language:'en',input_limit:4000});
      assert.deepEqual(await scope(db,B,SB),{project_id:PB,session_id:SB,language:'sv',input_limit:4000});
      await assert.rejects(()=>scope(db,B,SA),errorCode('P0002'));
      await assert.rejects(()=>scope(db,A,randomUUID()),errorCode('P0002'));
      await assert.rejects(()=>role(db,'anon',null,()=>rpc(db,'check_real_text_chat_scope',[SA],['uuid'])),errorCode('42501'));
      const ended=randomUUID();
      await db.query("INSERT INTO public.conversation_sessions(id,project_id,language,status,ended_at) VALUES($1,$2,'en','completed',now())",[ended,PA]);
      await assert.rejects(()=>scope(db,A,ended),errorCode('55000'));
    });

    await t.test('English/Swedish Unicode and exact whitespace persist as user originals, never fake transcripts',async()=>{
      const before=(await db.query('SELECT count(*)::integer AS n FROM public.real_transcripts')).rows[0].n;
      const text='  I lived in Malmö in 1980.\nMy mother was Åsa. 🧡  ';
      english=await typed(db,text,{memories:[{fact_type:'location',value:'Malmö',evidence:'Malmö',slot:'home'}]});
      swedish=await typed(db,'\tJag bodde i Göteborg 1978.\nÅsa var min vän.  ',{owner:B,project:PB,session:SB,assistant:'Vad minns du om Göteborg?',memories:[{fact_type:'location',value:'Göteborg',evidence:'Göteborg'}]});
      for(const {op,turn} of [english,swedish]){
        assert.equal(turn.user_message.id,op.operation_id);
        for(const message of [turn.user_message,turn.message]){
          assert.equal(message.source_transcript_id,null);assert.equal(message.source_text_input_id,op.operation_id);
          assert.equal(message.owner_id,undefined);assert.equal(message.operation_id,undefined);
        }
        assert.deepEqual(turn.user_message.provenance,original);assert.deepEqual(turn.message.provenance,provider);
        assert.ok(turn.memories.every(m=>m.source_message_id===op.operation_id&&m.status==='pending'));
      }
      assert.equal(english.turn.user_message.text,text);
      assert.equal(swedish.turn.user_message.language,'sv');assert.equal(swedish.turn.message.project_id,PB);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_transcripts')).rows[0].n,before);
      const raw=(await db.query('SELECT input_id,operation_id,owner_id,project_id,session_id,language,text FROM public.real_text_inputs WHERE input_id=$1',[english.op.operation_id])).rows[0];
      assert.deepEqual(raw,{input_id:english.op.operation_id,operation_id:english.op.operation_id,owner_id:A,project_id:PA,session_id:SA,language:'en',text});
    });

    await t.test('RLS and bounded batch hydration cannot reveal another user or other requested session',async()=>{
      const own=await user(db,A,()=>db.query('SELECT input_id FROM public.real_text_inputs'));
      assert.deepEqual(own.rows,[{input_id:english.op.operation_id}]);
      assert.equal((await user(db,B,()=>db.query('SELECT input_id FROM public.real_text_inputs WHERE input_id=$1',[english.op.operation_id]))).rows.length,0);
      assert.deepEqual(await sources(db,[english.op.operation_id]),{sources:[{input_id:english.op.operation_id,operation_id:english.op.operation_id,project_id:PA,session_id:SA,language:'en',text:english.turn.user_message.text}]});
      await assert.rejects(()=>sources(db,[english.op.operation_id],B,SA),errorCode('P0002'));
      await assert.rejects(()=>sources(db,[swedish.op.operation_id],A,SA),errorCode('P0002'));
      await assert.rejects(()=>sources(db,[english.op.operation_id,randomUUID()]),errorCode('P0002'));
      for(const ids of [null,[],[null],Array(101).fill(english.op.operation_id)])
        await assert.rejects(()=>sources(db,ids),errorCode('22023'));
      await assert.rejects(()=>role(db,'anon',null,()=>rpc(db,'get_real_text_chat_sources',[SA,[english.op.operation_id]],['uuid','uuid[]'])),errorCode('42501'));
    });

    await t.test('same action replays exactly once while same words under a new explicit key remain valid',async()=>{
      const text='Yes',key=randomUUID(),hash=digest({text,language:'en',input_type:'typed',key});
      const first=await claim(db,{key,hash});
      const repeated=await claim(db,{key,hash});assert.equal(repeated.claimed,false);assert.equal(repeated.claim_token,undefined);
      const turn=await complete(db,first,{input_text:text,assistant_text:'Thank you.',memories:[]});
      assert.deepEqual(await complete(db,first,{input_text:'changed',assistant_text:'changed',memories:[]}),turn);
      assert.deepEqual((await claim(db,{key,hash})).result,turn);
      await assert.rejects(()=>claim(db,{key,hash:digest('changed')}),errorCode('40001'));
      await assert.rejects(()=>complete(db,{...first,claim_token:randomUUID()},{input_text:text,assistant_text:'No',memories:[]}),errorCode('42501'));
      const nextKey=randomUUID(),next=await typed(db,text,{key:nextKey,hash:digest({text,language:'en',input_type:'typed',key:nextKey})});
      assert.notEqual(next.op.operation_id,first.operation_id);
      assert.equal(next.turn.user_message.text,text);assert.equal(next.turn.user_message.sequence,turn.message.sequence+1);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_text_inputs WHERE operation_id=$1',[first.operation_id])).rows[0].n,1);
    });

    await t.test('invalid source type/length/blank Unicode and mixed sources leave no partial originals',async()=>{
      const op=await claim(db);
      const before=(await db.query('SELECT count(*)::integer AS n FROM public.real_text_inputs')).rows[0].n;
      for(const input of [null,{},12,true,'',' \t\n\r','\u0085\u00a0\u1680\u2007\u2028\u202f\u3000','x'.repeat(4001)])
        await assert.rejects(()=>complete(db,op,{input_text:input,assistant_text:'Question',memories:[]}),errorCode('22023'));
      await assert.rejects(()=>complete(db,op,{assistant_text:'Question',memories:[]}),errorCode('22023'));
      await assert.rejects(()=>complete(db,op,{input_text:'Both',source_transcript_id:legacy.tr.transcript_id,assistant_text:'Question',memories:[]}),errorCode('22023'));
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_text_inputs')).rows[0].n,before);
      assert.equal((await db.query('SELECT status FROM public.real_ai_operations WHERE operation_id=$1',[op.operation_id])).rows[0].status,'in_progress');
      const limit=await complete(db,op,{input_text:'å'.repeat(4000),assistant_text:'Question',memories:[]});
      assert.equal(limit.user_message.text.length,4000);
    });

    await t.test('bad memory/assistant/provenance completion rolls back raw input and both messages atomically',async()=>{
      const op=await claim(db),text='I lived in Uppsala in 1984.';
      const result={input_text:text,assistant_text:'What was it like?',memories:[{fact_type:'location',value:'London',evidence:'London'}]};
      await assert.rejects(()=>complete(db,op,result),errorCode('22023'));
      await assert.rejects(()=>complete(db,op,{...result,memories:[{fact_type:'date',value:'1984',evidence:'Uppsala',year:1984}]}),errorCode('22023'));
      await assert.rejects(()=>complete(db,op,{...result,assistant_text:'',memories:[]}),errorCode('23514'));
      await assert.rejects(()=>complete(db,op,{...result,memories:[]},A,original),errorCode('22023'));
      for(const table of ['real_text_inputs','real_conversation_messages'])
        assert.equal((await db.query(`SELECT count(*)::integer AS n FROM public.${table} WHERE operation_id=$1`,[op.operation_id])).rows[0].n,0);
      const turn=await complete(db,op,{...result,memories:[{fact_type:'location',value:'Uppsala',evidence:'Uppsala'}]});
      assert.equal(turn.memories[0].evidence,'Uppsala');
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_conversation_messages WHERE operation_id=$1',[op.operation_id])).rows[0].n,2);
      await assert.rejects(()=>complete(db,op,result,B),errorCode('P0002'));
    });

    await t.test('typed originals/messages cannot be overwritten and reviews preserve the original evidence',async()=>{
      const id=english.op.operation_id;
      const before=(await db.query('SELECT to_jsonb(i) AS row FROM public.real_text_inputs i WHERE input_id=$1',[id])).rows[0].row;
      await assert.rejects(()=>db.query("UPDATE public.real_text_inputs SET text='replacement' WHERE input_id=$1",[id]),errorCode('55000'));
      await assert.rejects(()=>db.query('UPDATE public.real_text_inputs SET owner_id=$2 WHERE input_id=$1',[id,B]),errorCode('55000'));
      await assert.rejects(()=>db.query("UPDATE public.real_conversation_messages SET text='replacement' WHERE id=$1",[id]),errorCode('55000'));
      const memory=english.turn.memories[0];
      const reviewed=await user(db,A,()=>rpc(db,'review_real_memory',[memory.id,1,'confirmed','Göteborg'],['uuid','integer','text','text']));
      assert.equal(reviewed.corrected_value,'Göteborg');assert.equal(reviewed.value,'Malmö');assert.equal(reviewed.evidence,'Malmö');
      assert.deepEqual((await db.query('SELECT to_jsonb(i) AS row FROM public.real_text_inputs i WHERE input_id=$1',[id])).rows[0].row,before);
    });

    await t.test('privileged scope mistakes and missing/both source messages fail at the database boundary',async()=>{
      const op=await claim(db);
      const insert=(values)=>db.query('INSERT INTO public.real_text_inputs(input_id,owner_id,project_id,session_id,operation_id,language,text) VALUES($1,$2,$3,$4,$5,$6,$7)',values);
      const valid=[op.operation_id,A,PA,SA,op.operation_id,'en','Exact input'];
      for(const [index,value] of [[0,randomUUID()],[1,B],[2,PB],[3,SB],[5,'sv']]){
        const values=[...valid];values[index]=value;
        await assert.rejects(()=>insert(values),errorCode('23514'));
      }
      const wrongKind=await claim(db,{kind:'transcription'});
      await assert.rejects(()=>insert([wrongKind.operation_id,A,PA,SA,wrongKind.operation_id,'en','Exact input']),errorCode('23514'));
      await db.exec('BEGIN');
      try{
        await insert(valid);
        const message=(transcriptId,owner=A,text='Exact input',prov=original)=>db.query(`INSERT INTO public.real_conversation_messages
          (id,owner_id,project_id,session_id,operation_id,source_transcript_id,role,language,text,sequence,provenance)
          VALUES($1,$2,$3,$4,$5,$6,'user','en',$7,10000,$8)`,[op.operation_id,owner,PA,SA,op.operation_id,transcriptId,text,prov]);
        await db.exec('SAVEPOINT mistake');
        for(const attempt of [()=>message(legacy.tr.transcript_id),()=>message(null,B),()=>message(null,A,'edited'),()=>message(null,A,'Exact input',provider)]){
          await assert.rejects(attempt,errorCode('23514'));await db.exec('ROLLBACK TO SAVEPOINT mistake');
        }
        await message(null);
      }finally{await db.exec('ROLLBACK');}
      const missing=await claim(db);
      await assert.rejects(()=>db.query(`INSERT INTO public.real_conversation_messages
        (owner_id,project_id,session_id,operation_id,source_transcript_id,role,language,text,sequence,provenance)
        VALUES($1,$2,$3,$4,NULL,'assistant','en','Missing source',10000,$5)`,[A,PA,SA,missing.operation_id,provider]),errorCode('23514'));
    });

    await t.test('mixed voice/typed turns keep one ordered session and exact old voice response shape',async()=>{
      const previous=(await db.query('SELECT max(sequence)::integer AS n FROM public.real_conversation_messages WHERE session_id=$1',[SA])).rows[0].n;
      const next=await voice(db,'I remember Åsa.');
      assert.equal(next.turn.user_message.sequence,previous+1);
      assert.equal(next.turn.message.sequence,previous+2);
      assert.equal('source_text_input_id' in next.turn.user_message,false);
      assert.equal('source_text_input_id' in next.turn.message,false);
      assert.equal(next.turn.user_message.source_transcript_id,next.tr.transcript_id);
      assert.deepEqual(next.turn.user_message.provenance,provider);
      const after=await typed(db,'And then I met Björn.');
      assert.equal(after.turn.user_message.sequence,next.turn.message.sequence+1);
      const rows=(await user(db,A,()=>db.query('SELECT sequence FROM public.real_conversation_messages WHERE session_id=$1 ORDER BY sequence',[SA]))).rows;
      assert.deepEqual(rows.map(r=>Number(r.sequence)),Array.from({length:rows.length},(_,i)=>i+1));
    });

    await t.test('typed confirmed memories still generate stories and typed assistant replies accept owned speech metadata',async()=>{
      const context=await user(db,A,()=>rpc(db,'get_real_story_context',[PA],['uuid']));
      assert.ok(context.source_memories.some(m=>m.source_message_id===english.op.operation_id));
      const op=await claim(db,{kind:'generation',session:null});
      const draft=await complete(db,op,{content:'My reviewed memory of Göteborg.',source_memories:context.source_memories,model_review:{unsupported_claims:[]}});
      assert.equal(draft.status,'needs_review');assert.deepEqual(draft.source_memories,context.source_memories);
      const speech=await claim(db,{kind:'speech'});
      const audio=await complete(db,speech,{assistant_message_id:english.turn.message.id,media_type:'audio/wav',audio_sha256:'b'.repeat(64),audio_size:44,expires_at:new Date(Date.now()+60_000).toISOString()});
      assert.equal(audio.assistant_message_id,english.turn.message.id);assert.deepEqual(audio.provenance,provider);
    });

    await t.test('a Swedish owner can save original words with no extracted memories and use them through draft, edit and PDF',async()=>{
      const words='På Öland såg jag en groda. 🐸';
      const voiceTurn=await voice(db,'Vi var på semester. '+words,{owner:B,project:PB,session:SB});
      const before=await user(db,B,()=>rpc(db,'get_real_story_context',[PB],['uuid']));
      assert.equal(before.confirmed_count,0);
      const save=(owner,session,message,excerpt)=>user(db,owner,()=>rpc(db,'save_real_memory_from_message',
        [session,message,excerpt],['uuid','uuid','text']));
      const id=voiceTurn.turn.user_message.id;
      await assert.rejects(()=>save(A,SB,id,words),errorCode('P0002'));
      await assert.rejects(()=>save(B,SA,id,words),errorCode('P0002'));
      await assert.rejects(()=>save(B,SB,legacy.turn.user_message.id,words),errorCode('P0002'));
      await assert.rejects(()=>save(B,SB,voiceTurn.turn.message.id,'Tell me more.'),errorCode('P0002'));
      await assert.rejects(()=>role(db,'anon',null,()=>rpc(db,'save_real_memory_from_message',
        [SB,id,words],['uuid','uuid','text'])),errorCode('42501'));
      await assert.rejects(()=>user(db,null,()=>rpc(db,'save_real_memory_from_message',
        [SB,id,words],['uuid','uuid','text'])),errorCode('42501'));
      for(const invalid of [null,'',' ','\t','london','x'.repeat(1001)])
        await assert.rejects(()=>save(B,SB,id,invalid),errorCode('22023'));

      const saved=await save(B,SB,id,words);
      assert.equal(saved.source_message_id,id);
      assert.equal(saved.project_id,PB);
      assert.equal(saved.session_id,SB);
      assert.equal(saved.value,words);
      assert.equal(saved.evidence,words);
      assert.equal(saved.status,'confirmed');
      assert.equal(saved.clarification_question,null);
      assert.equal(saved.owner_id,undefined);
      assert.deepEqual(await save(B,SB,id,words),saved);
      assert.equal((await user(db,A,()=>db.query('SELECT id FROM public.real_memories WHERE id=$1',[saved.id]))).rows.length,0);
      await assert.rejects(()=>user(db,B,()=>db.exec('SELECT * FROM memy_private.user_selected_story_memories')),errorCode('42501'));

      const context=await user(db,B,()=>rpc(db,'get_real_story_context',[PB],['uuid']));
      assert.equal(context.confirmed_count,1);
      assert.equal(context.source_memories[0].evidence,words);
      const op=await claim(db,{kind:'generation',owner:B,project:PB,session:null});
      const draft=await complete(db,op,{content:words,source_memories:context.source_memories,
        model_review:{unsupported_claims:[]}},B);
      assert.equal(draft.language,'sv');
      const edited=await user(db,B,()=>rpc(db,'edit_real_story_draft',[draft.draft_id,1,'Jag såg en groda på Öland.'],
        ['uuid','integer','text']));
      const exported=await user(db,B,()=>rpc(db,'record_real_story_export',
        [draft.draft_id,edited.revision,'Svenska minnen',true,true,1,1024,'memy-svenska-minnen.pdf','memy_real_pdf_v1'],
        ['uuid','integer','text','boolean','boolean','integer','integer','text','text']));
      assert.equal(exported.draft_id,draft.draft_id);

      await user(db,B,()=>rpc(db,'review_real_memory',[saved.id,1,'rejected',null],['uuid','integer','text','text']));
      await assert.rejects(()=>save(B,SB,id,words),errorCode('40001'));
      await db.query('DELETE FROM public.real_conversation_messages WHERE id=$1',[id]);
      assert.equal((await db.query('SELECT memory_id FROM memy_private.user_selected_story_memories WHERE memory_id=$1',[saved.id])).rows.length,0);
    });

    await t.test('source/session/account cascades leave no typed-message or memory orphans',async()=>{
      const temporary=await typed(db,'I remember Lund.',{memories:[{fact_type:'location',value:'Lund',evidence:'Lund'}]});
      await db.query('DELETE FROM public.real_text_inputs WHERE input_id=$1',[temporary.op.operation_id]);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_conversation_messages WHERE operation_id=$1',[temporary.op.operation_id])).rows[0].n,0);
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_memories WHERE source_message_id=$1',[temporary.op.operation_id])).rows[0].n,0);
      await user(db,B,()=>db.query('DELETE FROM public.conversation_sessions WHERE id=$1',[SB]));
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_text_inputs WHERE session_id=$1',[SB])).rows[0].n,0);
      const project=randomUUID(),session=randomUUID();
      await db.query("INSERT INTO public.books(id,user_id,title,language) VALUES($1,$2,'Deletion fixture','en')",[project,A]);
      await db.query("INSERT INTO public.conversation_sessions(id,project_id,language) VALUES($1,$2,'en')",[session,project]);
      await typed(db,'A fictional erasure fixture.',{project,session});
      await user(db,A,()=>db.query('DELETE FROM public.books WHERE id=$1',[project]));
      assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.real_text_inputs WHERE project_id=$1',[project])).rows[0].n,0);
      await db.query('DELETE FROM auth.users WHERE id=$1',[A]);
      for(const table of ['real_text_inputs','real_conversation_messages','real_memories'])
        assert.equal((await db.query(`SELECT count(*)::integer AS n FROM public.${table} WHERE owner_id=$1`,[A])).rows[0].n,0);
    });
  }finally{await db.close();}
});

test('reviewable cloud typed-chat SQL executes wholly rollback-only with sanitized output',async()=>{
  const {db}=await setup();
  try{
    const tables=['users','books','conversation_sessions','real_ai_operations','real_text_inputs','real_conversation_messages','real_memories'];
    const counts=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await db.query(`SELECT count(*)::integer AS n FROM ${table==='users'?'auth':'public'}.${table}`)).rows[0].n])));
    const before=await counts();
    const sql=await readFile(new URL('./cloud-real-typed-chat.sql',import.meta.url),'utf8');
    assert.match(sql,/^BEGIN;/m);assert.match(sql,/ROLLBACK;\s*$/);
    assert.doesNotMatch(sql,/^\s*(?:COMMIT|ALTER|CREATE|DROP|GRANT|REVOKE)\b/im);
    const results=await db.exec(sql);
    const sanitized=results.flatMap(r=>r.rows??[]).find(row=>row.sanitized_result);
    assert.match(sanitized.sanitized_result,/^PASS:/);
    assert.doesNotMatch(JSON.stringify(sanitized),new RegExp(A+'|'+B+'|Malmö|Åsa'));
    assert.deepEqual(await counts(),before);
  }finally{await db.close();}
});
