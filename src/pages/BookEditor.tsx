import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import PageEditor from "@/components/PageEditor";
import BookViewer from "@/components/BookViewer";
import BookTemplateSelector, { type BookTemplate } from "@/components/BookTemplateSelector";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, BookOpen, ArrowLeft, Eye, Pencil, Palette } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FREEMIUM_MAX_PAGES = 8;
const FREEMIUM_MAX_IMAGES = 3;
const PREMIUM_MAX_PAGES = 300;
const PREMIUM_MAX_IMAGES = 999;

function getMaxPages(planType: string) {
  return planType === "premium" ? PREMIUM_MAX_PAGES : FREEMIUM_MAX_PAGES;
}
function getMaxImages(planType: string) {
  return planType === "premium" ? PREMIUM_MAX_IMAGES : FREEMIUM_MAX_IMAGES;
}

interface PageWithImages {
  id: string;
  book_id: string;
  page_number: number;
  title: string | null;
  content: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  layout_type: string;
  created_at: string;
  updated_at: string;
  images: { id: string; url: string; caption: string | null }[];
}

const BookEditor = () => {
  const { bookId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<PageWithImages[]>([]);
  const [totalImages, setTotalImages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const planType = book?.plan_type || "freemium";
  const isPremium = planType === "premium";
  const currentTemplate: BookTemplate = book?.book_template || "classic";

  useEffect(() => {
    if (user && bookId) loadBookData();
  }, [bookId, user]);

  async function loadBookData() {
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

      // Auto-populate pages with AI-structured interview content
      // Detect if pages need AI structuring: no content, or only generic "Kapitel N" titles
      const hasNoContent = !loadedPages.some(p => p.content && p.content.trim().length > 0);
      const hasOnlyGenericTitles = loadedPages.length > 0 && loadedPages.every(
        p => !p.title || /^(Kapitel|Sida)\s+\d+$/i.test(p.title)
      );
      const needsStructuring = hasNoContent || hasOnlyGenericTitles;
      if (needsStructuring) {
        // Check for interview turns
        const { data: turns } = await supabase
          .from("interview_turns")
          .select("question_text, user_answer, theme_id, created_at")
          .eq("book_id", bookId!)
          .order("created_at");

        if (turns && turns.length > 0) {
          toast({
            title: "Skapar boktext...",
            description: "AI strukturerar dina intervjusvar till kapitel. Detta kan ta en stund.",
          });

          // Delete existing empty pages
          if (loadedPages.length > 0) {
            await supabase.from("pages").delete().eq("book_id", bookId!);
          }

          // Group by theme
          const themeGroups = new Map<string, typeof turns>();
          turns.forEach(t => {
            const group = themeGroups.get(t.theme_id) || [];
            group.push(t);
            themeGroups.set(t.theme_id, group);
          });

          const newPages: PageWithImages[] = [];
          let chapterNum = 0;

          for (const [themeId, themeTurns] of themeGroups) {
            chapterNum++;
            const interviewText = themeTurns
              .map(t => `Fråga: ${t.question_text}\nSvar: ${t.user_answer}`)
              .join("\n\n");

            // Use AI to structure the chapter
            let title = themeId.charAt(0).toUpperCase() + themeId.slice(1).replace(/_/g, " ");
            let content = interviewText;

            try {
              const res = await supabase.functions.invoke("minna-interview", {
                body: {
                  action: "structure",
                  interviewText,
                  themeName: title,
                },
              });

              if (!res.error && res.data) {
                title = res.data.title || title;
                content = res.data.content || content;
              }
            } catch (err) {
              console.error("AI structuring failed for theme:", themeId, err);
              // Fallback: use raw text
            }

            const { data: pageData, error: insertErr } = await supabase
              .from("pages")
              .insert({
                book_id: bookId!,
                chapter_number: chapterNum,
                page_number: chapterNum,
                title,
                content,
              })
              .select("*, images(*)")
              .single();

            if (!insertErr && pageData) {
              newPages.push(pageData as unknown as PageWithImages);
            }
          }

          if (newPages.length > 0) {
            loadedPages = newPages;
            await supabase
              .from("books")
              .update({ page_count: newPages.length, updated_at: new Date().toISOString() })
              .eq("id", bookId!);

            toast({
              title: "Boktext skapad!",
              description: `${newPages.length} kapitel skapades från dina intervjusvar.`,
            });
          }
        } else if (bookData.transcription_text) {
          // Fallback for audio transcription (no interview turns)
          if (loadedPages.length > 0) {
            await supabase.from("pages").delete().eq("book_id", bookId!);
          }

          const paragraphs = bookData.transcription_text
            .split(/\n\n+/)
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 50);

          const limited = paragraphs.slice(0, getMaxPages(planType));

          if (limited.length > 0) {
            const inserts = limited.map((content: string, i: number) => ({
              book_id: bookId!,
              chapter_number: i + 1,
              page_number: i + 1,
              title: `Kapitel ${i + 1}`,
              content,
            }));

            const { data: newPages, error: insertErr } = await supabase
              .from("pages")
              .insert(inserts)
              .select("*, images(*)");

            if (!insertErr && newPages) {
              loadedPages = newPages as unknown as PageWithImages[];
              await supabase
                .from("books")
                .update({ page_count: limited.length, updated_at: new Date().toISOString() })
                .eq("id", bookId!);
            }
          }
        }
      }

      setPages(loadedPages);

      const { count } = await supabase
        .from("images")
        .select("*", { count: "exact", head: true })
        .eq("book_id", bookId!);

      setTotalImages(count || 0);
    } catch (error) {
      console.error("Error loading book:", error);
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function createNewPage() {
    if (pages.length >= getMaxPages(planType)) return;

    try {
      const nextPageNumber = pages.length + 1;
      const { data, error } = await supabase
        .from("pages")
        .insert([
          {
            book_id: bookId!,
            page_number: nextPageNumber,
            title: `Sida ${nextPageNumber}`,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      await supabase
        .from("books")
        .update({ page_count: nextPageNumber, updated_at: new Date().toISOString() })
        .eq("id", bookId!);

      setPages([...pages, { ...data, images: [] }]);
      setSelectedPageId(data.id);
    } catch (error) {
      console.error("Error creating page:", error);
    }
  }

  async function deletePage(pageId: string) {
    if (!confirm("Är du säker på att du vill radera denna sida?")) return;

    try {
      const { error } = await supabase.from("pages").delete().eq("id", pageId);
      if (error) throw error;
      if (selectedPageId === pageId) setSelectedPageId(null);
      await loadBookData();
    } catch (error) {
      console.error("Error deleting page:", error);
    }
  }

  async function handleTemplateChange(template: BookTemplate) {
    setSavingTemplate(true);
    try {
      const { error } = await supabase
        .from("books")
        .update({ book_template: template, updated_at: new Date().toISOString() })
        .eq("id", bookId!);
      if (error) throw error;
      setBook({ ...book, book_template: template });
      toast({ title: "Mall sparad!", description: `Mallen "${template}" har valts.` });
    } catch (error) {
      console.error("Error saving template:", error);
      toast({ title: "Fel", description: "Kunde inte spara mall.", variant: "destructive" });
    } finally {
      setSavingTemplate(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Editor header */}
      <header className="bg-primary text-primary-foreground p-4 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/dashboard")}
              className="flex items-center gap-1 hover:underline text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Mina berättelser
            </button>
            <h1 className="text-xl font-serif">{book?.title || "Min bok"}</h1>
          </div>
          <span className="text-sm opacity-90">
            {pages.length} / {getMaxPages(planType)} sidor · {totalImages} / {getMaxImages(planType)} bilder
            {isPremium && " ✨"}
          </span>
        </div>
      </header>

      <Tabs defaultValue="edit" className="flex-1 flex flex-col">
        <div className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-6">
            <TabsList className="bg-transparent h-auto p-0 gap-4">
              <TabsTrigger
                value="edit"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                <Pencil className="w-4 h-4 mr-2" />
                Redigera
              </TabsTrigger>
              <TabsTrigger
                value="design"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                <Palette className="w-4 h-4 mr-2" />
                Design
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
              >
                <Eye className="w-4 h-4 mr-2" />
                Förhandsvisning
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="flex-1 max-w-7xl mx-auto w-full p-6">
          <TabsContent value="edit" className="mt-0">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Sidebar – page list */}
              <div className="md:col-span-3">
                <div className="bg-card rounded-lg shadow p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-foreground">Sidor</h3>
                    <Button
                      size="icon"
                      variant="cta"
                      onClick={createNewPage}
                      disabled={pages.length >= getMaxPages(planType)}
                      title={
                        pages.length >= getMaxPages(planType)
                          ? `Max ${getMaxPages(planType)} sidor`
                          : "Lägg till ny sida"
                      }
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {pages.map((page) => (
                      <div
                        key={page.id}
                        onClick={() => setSelectedPageId(page.id)}
                        className={`p-3 rounded-md cursor-pointer transition-colors ${
                          selectedPageId === page.id
                            ? "bg-secondary/15 border-2 border-secondary"
                            : "bg-muted/40 hover:bg-muted"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground truncate">
                              {page.title || `Sida ${page.page_number}`}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {page.images?.length || 0} bilder
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePage(page.id);
                            }}
                            className="text-destructive/60 hover:text-destructive ml-2"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {pages.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Inga sidor än. Klicka på + för att skapa din första sida.
                    </p>
                  )}
                </div>

                {!isPremium && pages.length >= FREEMIUM_MAX_PAGES && (
                  <div className="mt-4 p-3 bg-accent border border-border rounded-md text-sm">
                    <p className="text-muted-foreground">
                      ⚠️ Max {FREEMIUM_MAX_PAGES} sidor i Freemium
                    </p>
                    <button
                      onClick={() => navigate("/#priser")}
                      className="text-primary hover:underline mt-1 font-medium"
                    >
                      Uppgradera →
                    </button>
                  </div>
                )}
              </div>

              {/* Main content – page editor */}
              <div className="md:col-span-9">
                {selectedPageId ? (
                  <PageEditor
                    pageId={selectedPageId}
                    bookId={bookId!}
                    totalImages={totalImages}
                    maxImages={getMaxImages(planType)}
                    onUpdate={loadBookData}
                  />
                ) : (
                  <div className="bg-card rounded-lg shadow p-12 text-center">
                    <BookOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                    <p className="text-muted-foreground">
                      Välj en sida från listan eller skapa en ny för att börja redigera
                    </p>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="design" className="mt-0">
            <div className="bg-card rounded-lg shadow p-8">
              <h2 className="text-2xl font-serif mb-2 text-foreground">Välj bokmall</h2>
              <p className="text-muted-foreground mb-6">
                Välj en designmall som bestämmer utseendet på din bok – både i förhandsvisningen och i den exporterade PDF:en.
              </p>
              <BookTemplateSelector
                selected={currentTemplate}
                onSelect={handleTemplateChange}
                disabled={savingTemplate}
              />
              {savingTemplate && (
                <p className="text-sm text-muted-foreground mt-4 animate-pulse">Sparar mall...</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            <BookViewer
              pages={pages}
              bookTitle={book?.title || "Min bok"}
              template={currentTemplate}
              isPremium={isPremium}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default BookEditor;
