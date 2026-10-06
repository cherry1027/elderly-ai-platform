import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_story",
  title: "Skapa berättelse",
  description: "Spara en ny berättelse (titel och text) åt den inloggade användaren.",
  inputSchema: {
    title: z.string().trim().min(1).describe("Berättelsens titel."),
    content: z.string().trim().min(1).describe("Berättelsens text på svenska."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, content }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Inte inloggad." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("stories")
      .insert({ user_id: ctx.getUserId(), title, content })
      .select("id, title, content, created_at")
      .single();

    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { story: data },
    };
  },
});
