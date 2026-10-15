import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createDeletionRemindersHandler } from "./handler.ts";

Deno.serve(createDeletionRemindersHandler({
  getEnv: (name) => Deno.env.get(name),
  createClient,
}));
