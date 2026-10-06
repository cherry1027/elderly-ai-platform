import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_book",
  title: "Hämta bok med sidor",
  description: "Hämta en bok och dess sidor (kapitel, rubriker och text) för den inloggade användaren.",
  inputSchema: { book_id: z.string().uuid().describe("Bokens id.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ book_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Inte inloggad." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id, title, description, status, page_count, plan_type, book_template, last_edited")
      .eq("id", book_id)
      .maybeSingle();

    if (bookError) return { content: [{ type: "text", text: bookError.message }], isError: true };
    if (!book) return { content: [{ type: "text", text: "Boken hittades inte." }], isError: true };

    const { data: pages, error: pagesError } = await supabase
      .from("pages")
      .select("id, page_number, chapter_number, title, content, layout_type")
      .eq("book_id", book_id)
      .order("page_number");

    if (pagesError) return { content: [{ type: "text", text: pagesError.message }], isError: true };

    const result = { book, pages: pages ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  },
});
