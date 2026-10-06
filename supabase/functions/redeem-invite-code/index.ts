import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Payload {
  email: string;
  password: string;
  displayName?: string;
  code: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Payload;
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const displayName = (body.displayName || "").trim().slice(0, 100);
    const code = (body.code || "").trim().toUpperCase();

    if (!email || !email.includes("@") || email.length > 255) {
      return json({ error: "Ogiltig e-postadress." }, 400);
    }
    if (password.length < 8 || password.length > 200) {
      return json({ error: "Lösenordet måste vara minst 8 tecken." }, 400);
    }
    if (!code || code.length > 64) {
      return json({ error: "Ogiltig inbjudningskod." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Lookup code
    const { data: invite, error: inviteErr } = await admin
      .from("invite_codes")
      .select("*")
      .eq("code", code)
      .eq("active", true)
      .maybeSingle();

    if (inviteErr) throw inviteErr;
    if (!invite) {
      return json({ error: "Inbjudningskoden finns inte eller är inte aktiv." }, 400);
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return json({ error: "Inbjudningskoden har gått ut." }, 400);
    }
    if (invite.max_uses !== null && invite.used_count >= invite.max_uses) {
      return json({ error: "Inbjudningskoden har använts för många gånger." }, 400);
    }

    // Create user (skip email confirmation if configured)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: !!invite.skip_email_verification,
      user_metadata: { display_name: displayName || email },
    });

    if (createErr || !created.user) {
      const msg = createErr?.message || "Kunde inte skapa konto.";
      const friendly = /already/i.test(msg)
        ? "Ett konto med den e-postadressen finns redan."
        : msg;
      return json({ error: friendly }, 400);
    }

    const userId = created.user.id;

    // Mark profile as demo premium so new books get plan_type=premium.
    if (invite.grants_premium) {
      await admin
        .from("profiles")
        .update({ is_demo_premium: true })
        .eq("user_id", userId);
    }

    // Log redemption + bump counter
    await admin.from("invite_redemptions").insert({
      invite_code_id: invite.id,
      user_id: userId,
    });
    await admin
      .from("invite_codes")
      .update({ used_count: invite.used_count + 1 })
      .eq("id", invite.id);

    return json({ success: true });
  } catch (e: any) {
    console.error("redeem-invite-code error", e);
    return json({ error: e?.message || "Internt fel." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
