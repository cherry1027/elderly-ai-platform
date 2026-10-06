import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import BookViewer from "@/components/BookViewer";
import { type BookTemplate } from "@/components/BookTemplateSelector";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { ArrowLeft, Pencil, Download } from "lucide-react";

interface PageWithImages {
  id: string;
  page_number: number;
  title: string | null;
  content: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  images: { id: string; url: string; caption: string | null }[];
}

const BookPreview = () => {
  const { bookId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<PageWithImages[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && bookId) loadBook();
  }, [user, bookId]);

  async function loadBook() {
    try {
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId!)
        .eq("user_id", user!.id)
        .maybeSingle();

      if (bookError) throw bookError;
      if (!bookData) {
        navigate("/dashboard");
        return;
      }
      setBook(bookData);

      const { data: pagesData, error: pagesError } = await supabase
        .from("pages")
        .select("*, images(*)")
        .eq("book_id", bookId!)
        .order("page_number");

      if (pagesError) throw pagesError;
      let loadedPages = (pagesData as unknown as PageWithImages[]) || [];

      // If all pages have empty content, try building from interview_turns
      const hasContent = loadedPages.some(p => p.content && p.content.trim().length > 0);
      if (!hasContent) {
        const { data: turns } = await supabase
          .from("interview_turns")
          .select("question_text, user_answer, theme_id, created_at")
          .eq("book_id", bookId!)
          .order("created_at");

        if (turns && turns.length > 0) {
          // Group by theme
          const themeGroups = new Map<string, typeof turns>();
          turns.forEach(t => {
            const group = themeGroups.get(t.theme_id) || [];
            group.push(t);
            themeGroups.set(t.theme_id, group);
          });

          // Build virtual pages from interview data
          const virtualPages: PageWithImages[] = [];
          let pageNum = 1;
          themeGroups.forEach((themeTurns, themeId) => {
            const themeContent = themeTurns
              .map(t => `${t.question_text}\n\n${t.user_answer}`)
              .join("\n\n---\n\n");

            virtualPages.push({
              id: `virtual-${themeId}`,
              page_number: pageNum++,
              title: themeId.charAt(0).toUpperCase() + themeId.slice(1),
              content: themeContent,
              audio_url: null,
              audio_duration: null,
              images: [],
            });
          });

          if (virtualPages.length > 0) {
            loadedPages = virtualPages;
          }
        }
      }

      setPages(loadedPages);
    } catch (error) {
      console.error("Error loading book:", error);
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  const template: BookTemplate = book?.book_template || "classic";
  const isPremium = book?.plan_type === "premium";

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      {/* Breadcrumb + actions bar */}
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/dashboard">Mina berättelser</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to={`/bok/${bookId}`}>{book?.title || "Min bok"}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Förhandsvisning</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate(`/bok/${bookId}`)}
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Redigera</span>
            </Button>
            <Button
              variant="cta"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate(`/bok/${bookId}/export`)}
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exportera</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Book viewer */}
      <main className="flex-1 container mx-auto px-4 py-8">
        <BookViewer
          pages={pages}
          bookTitle={book?.title || "Min bok"}
          template={template}
          isPremium={isPremium}
        />
      </main>
    </div>
  );
};

export default BookPreview;
