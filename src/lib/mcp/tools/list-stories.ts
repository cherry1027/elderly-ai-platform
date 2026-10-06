import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_stories",
  title: "Lista berättelser",
  description: "Lista den inloggade användarens sparade berättelser, valfritt fritextsökta på titel.",
  inputSchema: {
    search: z.string().trim().min(1).optional().describe("Sökord som matchas mot titeln."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Inte inloggad." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("stories")
      .select("id, title, content, image_url, created_at")
      .order("created_at", { ascending: false });
    if (search) query = query.ilike("title", `%${search}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { stories: data ?? [] },
    };
  },
});
