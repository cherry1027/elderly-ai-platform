import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getConfig() {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  );
  const { data } = await supabase
    .from("minna_config")
    .select("*")
    .eq("id", "default")
    .single();
  return data;
}

async function callAI(systemPrompt: string, userPrompt: string, temperature = 0.7) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw { status: 429, message: "Rate limit exceeded" };
    }
    if (response.status === 402) {
      throw { status: 402, message: "Payment required" };
    }
    const t = await response.text();
    console.error("AI gateway error:", response.status, t);
    throw new Error("AI gateway error");
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJSON(content: string, fallback: any) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch {
    return fallback;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, userAnswer, currentQuestion, conversationHistory, interviewText, themeName, personName } = await req.json();
    const config = await getConfig();

    if (action === "followup") {
      const systemPrompt = config?.followup_system_prompt || "Du är Minna, en varm AI-intervjuare på svenska.";
      const userPrompt = `AKTUELL FRÅGA: "${currentQuestion}"
ANVÄNDARENS SVAR: "${userAnswer}"
TIDIGARE KONVERSATION (senaste 3):
${(conversationHistory || []).slice(-3).map((msg: any) => `${msg.role}: ${msg.content}`).join('\n')}

Ge din bekräftelse och följdfråga.`;

      const content = await callAI(systemPrompt, userPrompt, 0.8);
      const parsed = parseJSON(content, {
        acknowledgment: "Tack för att du delar det med mig.",
        followUpQuestion: "Berätta mer om det.",
        emotion: "warm",
      });

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "structure") {
      const systemPrompt = config?.structure_system_prompt || "Du strukturerar intervjusvar till bokkapitel på svenska.";
      const userPrompt = `Strukturera följande intervjusvar till ett sammanhängande kapitel.

TEMA: ${themeName}

INTERVJUSVAR:
${interviewText}

UPPGIFT:
1. Skapa en engagerande kapiteltitel
2. Skriv om svaren till en flytande berättelse i första person
3. Behåll alla viktiga detaljer och den personliga rösten
4. Ta bort upprepningar
5. Gör texten läsbar men autentisk
6. LÄGG INTE TILL information som inte finns i originaltexten`;

      const content = await callAI(systemPrompt, userPrompt);
      const parsed = parseJSON(content, { title: themeName, content: interviewText });

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (action === "structure-test") {
      const displayName = personName || "berättaren";
      const systemPrompt = config?.structure_test_system_prompt || "Du strukturerar talad text till bokkapitel på svenska.";
      const userPrompt = `Strukturera denna berättelse till ett bokkapitel med rubriker.

TEMA: ${themeName}
PERSON: ${displayName}

TRANSKRIBERAD TEXT:
${interviewText}`;

      const content = await callAI(systemPrompt, userPrompt);
      let parsed = parseJSON(content, {
        title: themeName,
        sections: [{ heading: "", text: interviewText }],
      });

      if (!parsed.sections || !Array.isArray(parsed.sections)) {
        parsed = {
          title: parsed.title || themeName,
          sections: [{ heading: "", text: parsed.content || interviewText }],
        };
      }

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
    console.error("minna-interview error:", e);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
