import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listBooksTool from "./tools/list-books";
import getBookTool from "./tools/get-book";
import listStoriesTool from "./tools/list-stories";
import createStoryTool from "./tools/create-story";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "ny-minaminnen-se",
  title: "NY Minaminnen.se",
  version: "0.1.0",
  instructions:
    "Verktyg för Mina Minnen — en svensk plattform för livsberättelser och minnesböcker. Använd list_books och get_book för att läsa användarens böcker och kapitel, list_stories för sparade berättelser och create_story för att spara en ny berättelse. Skriv alltid på svenska och hitta aldrig på detaljer som användaren inte berättat.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listBooksTool, getBookTool, listStoriesTool, createStoryTool],
});
