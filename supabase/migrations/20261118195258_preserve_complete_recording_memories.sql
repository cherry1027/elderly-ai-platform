BEGIN;

-- Keep the reviewed ownership, claim, exclusion and retry protections in the
-- current function. Recordings may add complete original passages alongside
-- eight extracted details. Typed chat retains its existing eight-item limit.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure);
  old_limit text := 'jsonb_array_length(p_result->''memories'')>8';
  new_limit text := 'jsonb_array_length(p_result->''memories'') > (CASE WHEN typed_source IS NULL THEN 48 ELSE 8 END)';
  old_columns text := 'fact_type,value,evidence,year,slot,uncertain)';
  new_columns text := 'fact_type,value,evidence,year,slot,uncertain,created_at)';
  old_declaration text := 'conflict_id uuid; q text; seq bigint; draft_version integer; clarification public.real_memory_clarifications;';
  new_declaration text := old_declaration || ' memory_created_at timestamptz := clock_timestamp();';
  old_values text := 'NULLIF(f->>''slot'',''''),COALESCE((f->>''uncertain'')::boolean,false)) RETURNING * INTO mem;';
  new_values text := 'NULLIF(f->>''slot'',''''),COALESCE((f->>''uncertain'')::boolean,false),greatest(clock_timestamp(),memory_created_at+interval ''1 microsecond'')) RETURNING * INTO mem; memory_created_at:=mem.created_at;';
BEGIN
  IF strpos(definition,new_limit)>0 AND strpos(definition,new_values)>0 THEN
    RETURN;
  END IF;
  IF (length(definition)-length(replace(definition,old_limit,''))) <> length(old_limit)
    OR (length(definition)-length(replace(definition,old_columns,''))) <> length(old_columns)
    OR (length(definition)-length(replace(definition,old_declaration,''))) <> length(old_declaration)
    OR (length(definition)-length(replace(definition,old_values,''))) <> length(old_values) THEN
    RAISE EXCEPTION 'Unexpected real AI completion definition; review the migration' USING ERRCODE='55000';
  END IF;
  definition := replace(definition,old_limit,new_limit);
  definition := replace(definition,old_columns,new_columns);
  definition := replace(definition,old_declaration,new_declaration);
  -- Real insertion timestamps preserve the order of consecutive source
  -- passages when the conversation is reloaded or used as a draft snapshot.
  definition := replace(definition,old_values,new_values);
  EXECUTE definition;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
