import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not configured");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // Get auth token from request
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;
    const bookId = formData.get("bookId") as string;

    if (!audioFile || !bookId) {
      return new Response(JSON.stringify({ error: "Missing audio file or bookId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update book status to processing
    await supabase
      .from("books")
      .update({ transcription_status: "processing" })
      .eq("id", bookId)
      .eq("user_id", user.id);

    // Upload audio to storage
    const audioBytes = await audioFile.arrayBuffer();
    const fileName = `${user.id}/${bookId}/raw_recording_${Date.now()}.webm`;
    const { error: uploadError } = await supabase.storage
      .from("book-audio")
      .upload(fileName, audioBytes, {
        contentType: audioFile.type || "audio/webm",
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
    }

    // Call ElevenLabs Scribe for transcription
    console.log("Sending audio to ElevenLabs Scribe for transcription...");

    const apiFormData = new FormData();
    const audioBlob = new Blob([audioBytes], { type: audioFile.type || "audio/webm" });
    apiFormData.append("file", audioBlob, "recording.webm");
    apiFormData.append("model_id", "scribe_v2");
    apiFormData.append("language_code", "swe");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: apiFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs Scribe error:", response.status, errorText);

      await supabase
        .from("books")
        .update({ transcription_status: "failed" })
        .eq("id", bookId)
        .eq("user_id", user.id);

      throw new Error(`Transcription failed [${response.status}]: ${errorText}`);
    }

    const result = await response.json();
    const transcribedText = result.text || "";

    // --- AI Structuring: create title + professional content ---
    let structuredTitle = "";
    let structuredContent = transcribedText;

    if (LOVABLE_API_KEY && transcribedText.length > 50) {
      try {
        console.log("Structuring content with AI...");
        const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: `Du är en erfaren redaktör som strukturerar intalade berättelser till professionella bokkapitel på svenska.

REGLER:
- Bevara berättarens personliga röst och alla viktiga detaljer
- Ta bort upprepningar, fyllnadsord (eh, öh, liksom) och ofullständiga meningar
- Organisera innehållet i logiska stycken med naturliga övergångar
- Skriv i första person
- Skapa en engagerande kapiteltitel som fångar berättelsens kärna
- Svara ALLTID i exakt detta JSON-format:
{"title": "Kapiteltitel", "content": "Den strukturerade berättelsen med styckeindelning"}`
              },
              {
                role: "user",
                content: `Strukturera följande intalade berättelse till ett professionellt bokkapitel:\n\n${transcribedText}`
              }
            ],
            temperature: 0.7,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const aiContent = aiData.choices?.[0]?.message?.content || "";
          try {
            const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiContent);
            structuredTitle = parsed.title || "";
            structuredContent = parsed.content || transcribedText;
            console.log("AI structuring complete, title:", structuredTitle);
          } catch {
            console.error("Failed to parse AI response, using raw text");
          }
        }
      } catch (aiErr) {
        console.error("AI structuring error (non-fatal):", aiErr);
      }
    }

    // Save transcription, structured content, and audio URL to book
    const { data: signedUrlData } = await supabase.storage
      .from("book-audio")
      .createSignedUrl(fileName, 3600);

    // Get book info for title update
    const { data: bookData } = await supabase
      .from("books")
      .select("title")
      .eq("id", bookId)
      .single();

    const updateData: Record<string, unknown> = {
      transcription_text: structuredContent,
      transcription_status: "completed",
      raw_audio_url: signedUrlData?.signedUrl || fileName,
      updated_at: new Date().toISOString(),
    };

    // If user hasn't set a custom title, use AI-generated one
    if (structuredTitle && bookData?.title === "Min bok") {
      updateData.title = structuredTitle;
    }

    await supabase
      .from("books")
      .update(updateData)
      .eq("id", bookId)
      .eq("user_id", user.id);

    // Create a first page/chapter with the structured content
    if (structuredContent) {
      await supabase.from("pages").insert({
        book_id: bookId,
        page_number: 1,
        chapter_number: 1,
        title: structuredTitle || "Kapitel 1",
        content: structuredContent,
        layout_type: "standard",
      });

      // Update page count
      await supabase
        .from("books")
        .update({ page_count: 1 })
        .eq("id", bookId)
        .eq("user_id", user.id);
    }

    console.log("Transcription + structuring completed, text length:", structuredContent.length);

    return new Response(
      JSON.stringify({
        text: structuredContent,
        title: structuredTitle,
        status: "completed",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Transcription error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
