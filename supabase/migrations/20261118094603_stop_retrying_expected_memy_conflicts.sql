-- These are business conflicts that require a new client decision.
-- PostgREST 14 can retry deliberately raised serialization errors indefinitely.
DO $migration$
DECLARE
  target record;
  routine regprocedure;
  original text;
  replacement text;
  access_before jsonb;
  access_after jsonb;
  retrying constant text := $pattern$(USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*)'40001'$pattern$;
  conflict constant text := $pattern$USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*'PT409'$pattern$;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  FOR target IN SELECT * FROM (VALUES
    ('public.review_real_memory(uuid,integer,text,text)', 2),
    ('public.edit_real_story_draft(uuid,integer,text)', 1),
    ('public.record_real_story_export(uuid,integer,text,boolean,boolean,integer,integer,text,text)', 1),
    ('public.claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text)', 3),
    ('public.complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb)', 6),
    ('memy_private.save_real_memory_from_message(uuid,uuid,text)', 1)
  ) AS expected(signature, conflict_count)
  LOOP
    routine := to_regprocedure(target.signature);
    IF routine IS NULL THEN
      RAISE EXCEPTION 'Missing expected function %', target.signature;
    END IF;
    original := pg_get_functiondef(routine);
    IF regexp_count(original, retrying, 1, 'i') <> target.conflict_count THEN
      RAISE EXCEPTION 'Unexpected retry codes in %', target.signature;
    END IF;
    replacement := regexp_replace(original, retrying, $rewrite$\1'PT409'$rewrite$, 'gi');
    IF regexp_count(replacement, conflict, 1, 'i')
      <> regexp_count(original, conflict, 1, 'i') + target.conflict_count THEN
      RAISE EXCEPTION 'Unexpected conflict rewrite in %', target.signature;
    END IF;
    SELECT jsonb_build_array(proowner, proacl, prosecdef, proconfig) INTO access_before
      FROM pg_proc WHERE oid=routine;
    EXECUTE replacement;
    SELECT jsonb_build_array(proowner, proacl, prosecdef, proconfig) INTO access_after
      FROM pg_proc WHERE oid=routine;
    IF access_after IS DISTINCT FROM access_before OR pg_get_functiondef(routine) <> replacement THEN
      RAISE EXCEPTION 'Function definition or access settings changed unexpectedly for %', target.signature;
    END IF;
  END LOOP;
END $migration$;
