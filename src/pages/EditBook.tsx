import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Eye, Download, Pencil, Trash2, Wand2, Scissors, BookOpen, ImagePlus, MessageCircle } from "lucide-react";
import { getAllThemes } from "@/data/interviewQuestions";
import { toast } from "sonner";

const FREEMIUM_MAX_PAGES = 8;

interface Chapter {
  id: string;
  title: string | null;
  content: string | null;
  chapter_number: number | null;
  page_number: number;
  images: { id: string; url: string; caption: string | null }[];
}

const EditBook = () => {
  const { bookId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [book, setBook] = useState<any>(null);
  const [transcriptionText, setTranscriptionText] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && bookId) loadBook();
  }, [bookId, user]);

  async function loadBook() {
    try {
      const { data: bookData, error } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId!)
        .eq("user_id", user!.id)
        .maybeSingle();

      if (error) throw error;
      if (!bookData) {
        navigate("/dashboard");
        return;
      }

      setBook(bookData);

      // Use transcription_text if available, otherwise build from interview_turns
      let transcript = bookData.transcription_text || "";
      
      if (!transcript) {
        const { data: turns } = await supabase
          .from("interview_turns")
          .select("question_text, user_answer, theme_id, created_at")
          .eq("book_id", bookId!)
          .order("created_at");

        if (turns && turns.length > 0) {
          transcript = turns
            .map((t: any) => `**${t.question_text}**\n${t.user_answer}`)
            .join("\n\n");
        }
      }

      setTranscriptionText(transcript);

      const { data: pagesData } = await supabase
        .from("pages")
        .select("*, images(*)")
        .eq("book_id", bookId!)
        .order("chapter_number", { ascending: true, nullsFirst: false })
        .order("page_number");

      const loadedChapters = (pagesData as unknown as Chapter[]) || [];
      setChapters(loadedChapters);

      // Auto-create chapters from interview data if pages exist but have no content
      const hasContent = loadedChapters.some(ch => ch.content && ch.content.trim().length > 0);
      if (!hasContent && transcript && transcript.trim().length > 0) {
        // Auto-trigger chapter creation
        toast.info("Skapar kapitel från dina intervjusvar...");
        await autoCreateChaptersFromTranscript(bookId!, transcript, loadedChapters);
      }
    } catch (err) {
      console.error("Error loading book:", err);
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function autoCreateChaptersFromTranscript(bookIdParam: string, transcript: string, existingChapters: Chapter[]) {
    try {
      // Delete existing empty pages
      if (existingChapters.length > 0) {
        await supabase.from("pages").delete().eq("book_id", bookIdParam);
      }

      const paragraphs = transcript
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 50);

      const limited = paragraphs.slice(0, FREEMIUM_MAX_PAGES);

      const inserts = limited.map((content, i) => ({
        book_id: bookIdParam,
        chapter_number: i + 1,
        page_number: i + 1,
        title: `Kapitel ${i + 1}`,
        content,
      }));

      const { data, error } = await supabase
        .from("pages")
        .insert(inserts)
        .select("*, images(*)");

      if (error) throw error;

      await supabase
        .from("books")
        .update({ page_count: limited.length, updated_at: new Date().toISOString() })
        .eq("id", bookIdParam);

      setChapters((data as unknown as Chapter[]) || []);
      toast.success(`${limited.length} kapitel skapade automatiskt från dina intervjusvar!`);
    } catch (err) {
      console.error("Auto-create chapters error:", err);
    }
  }

  async function autoSplitIntoChapters() {
    if (!transcriptionText.trim()) {
      toast.error("Ingen transkription att dela upp");
      return;
    }
    if (chapters.length > 0) {
      if (!confirm("Befintliga kapitel kommer att ersättas. Fortsätta?")) return;
      // Delete existing chapters
      await supabase.from("pages").delete().eq("book_id", bookId!);
    }

    const paragraphs = transcriptionText
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 50);

    const limited = paragraphs.slice(0, FREEMIUM_MAX_PAGES);

    try {
      const inserts = limited.map((content, i) => ({
        book_id: bookId!,
        chapter_number: i + 1,
        page_number: i + 1,
        title: `Kapitel ${i + 1}`,
        content,
      }));

      const { data, error } = await supabase
        .from("pages")
        .insert(inserts)
        .select("*, images(*)");

      if (error) throw error;

      await supabase
        .from("books")
        .update({ page_count: limited.length, updated_at: new Date().toISOString() })
        .eq("id", bookId!);

      setChapters((data as unknown as Chapter[]) || []);
      toast.success(`${limited.length} kapitel skapade!`);
    } catch (err: any) {
      console.error(err);
      toast.error("Kunde inte dela upp i kapitel");
    }
  }

  function handleCreateFromSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString();

    if (!selectedText || selectedText.length < 10) {
      toast.error("Markera text i transkriptionen för att skapa ett kapitel");
      return;
    }
    if (chapters.length >= FREEMIUM_MAX_PAGES) {
      toast.error(`Max ${FREEMIUM_MAX_PAGES} kapitel i Freemium`);
      return;
    }

    createChapter(selectedText);
  }

  async function createChapter(content: string) {
    try {
      const nextNum = chapters.length + 1;
      const { data, error } = await supabase
        .from("pages")
        .insert({
          book_id: bookId!,
          chapter_number: nextNum,
          page_number: nextNum,
          title: `Kapitel ${nextNum}`,
          content: content.trim(),
        })
        .select("*, images(*)")
        .single();

      if (error) throw error;

      await supabase
        .from("books")
        .update({ page_count: nextNum, updated_at: new Date().toISOString() })
        .eq("id", bookId!);

      setChapters((prev) => [...prev, data as unknown as Chapter]);
      toast.success("Kapitel skapat!");
    } catch (err) {
      console.error(err);
      toast.error("Kunde inte skapa kapitel");
    }
  }

  async function updateChapter(chapterId: string) {
    try {
      const { error } = await supabase
        .from("pages")
        .update({ title: editTitle, content: editContent })
        .eq("id", chapterId);

      if (error) throw error;

      setChapters((prev) =>
        prev.map((ch) =>
          ch.id === chapterId ? { ...ch, title: editTitle, content: editContent } : ch
        )
      );
      setEditingChapterId(null);
      toast.success("Kapitel uppdaterat");
    } catch (err) {
      console.error(err);
      toast.error("Kunde inte uppdatera");
    }
  }

  async function deleteChapter(chapterId: string) {
    if (!confirm("Vill du radera detta kapitel?")) return;
    try {
      const { error } = await supabase.from("pages").delete().eq("id", chapterId);
      if (error) throw error;
      setChapters((prev) => prev.filter((ch) => ch.id !== chapterId));
      toast.success("Kapitel raderat");
    } catch (err) {
      console.error(err);
      toast.error("Kunde inte radera");
    }
  }

  async function uploadImageToChapter(chapterId: string, file: File) {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not authenticated");

      const fileName = `${authUser.id}/${bookId}/${chapterId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("book-images")
        .upload(fileName, file, { contentType: file.type });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from("book-images").getPublicUrl(fileName);

      const { error: insertErr } = await supabase.from("images").insert({
        book_id: bookId!,
        page_id: chapterId,
        url: urlData.publicUrl,
        position: 0,
      });

      if (insertErr) throw insertErr;

      await loadBook();
      toast.success("Bild tillagd!");
    } catch (err: any) {
      console.error(err);
      toast.error("Kunde inte ladda upp bild: " + err.message);
    }
  }

  function startEditing(chapter: Chapter) {
    setEditingChapterId(chapter.id);
    setEditTitle(chapter.title || "");
    setEditContent(chapter.content || "");
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
      {/* Header */}
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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/bok/${bookId}/preview`)}
              className="gap-1"
            >
              <Eye className="w-4 h-4" />
              Förhandsgranska
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate(`/bok/${bookId}/export`)}
              className="gap-1"
            >
              <Download className="w-4 h-4" />
              Exportera
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        {/* Guided Interview Theme Selector */}
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center gap-2 mb-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            <h2 className="font-serif text-xl font-semibold text-foreground">
              Guidat samtal med Minna
            </h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Välj ett tema så ställer Minna frågor och hjälper dig berätta din historia.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {getAllThemes().map(theme => (
              <button
                key={theme.id}
                onClick={() => navigate(`/bok/${bookId}/intervju/${theme.id}`)}
                className="p-4 rounded-lg border border-border bg-muted/30 hover:bg-primary/10 hover:border-primary/40 transition text-left group"
              >
                <div className="text-2xl mb-2">{theme.icon}</div>
                <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition">{theme.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{theme.questions.length} frågor</p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* LEFT: Transcription */}
          <div className="col-span-7">
            <div className="bg-card rounded-lg shadow p-6 sticky top-6">
              <h2 className="font-serif text-xl font-semibold text-foreground mb-4">
                Fullständig transkription
              </h2>

              <div className="mb-4 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={autoSplitIntoChapters}
                  className="gap-1"
                >
                  <Wand2 className="w-4 h-4" />
                  Dela automatiskt i kapitel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCreateFromSelection}
                  className="gap-1"
                >
                  <Scissors className="w-4 h-4" />
                  Kapitel från markerad text
                </Button>
              </div>

              {transcriptionText ? (
                <div
                  className="bg-muted/30 rounded-lg p-6 max-h-[600px] overflow-y-auto border border-border select-text"
                >
                  <p className="whitespace-pre-wrap leading-relaxed text-foreground/80">
                    {transcriptionText}
                  </p>
                </div>
              ) : (
                <div className="bg-muted/30 rounded-lg p-12 text-center border border-border">
                  <BookOpen className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
                  <p className="text-muted-foreground">Ingen transkription finns ännu.</p>
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-4">
                💡 Markera text med musen och klicka "Kapitel från markerad text" för manuell uppdelning
              </p>
            </div>
          </div>

          {/* RIGHT: Chapters */}
          <div className="col-span-5">
            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-serif text-xl font-semibold text-foreground">
                  Kapitel ({chapters.length}/{FREEMIUM_MAX_PAGES})
                </h2>
              </div>

              {chapters.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="mb-2">Inga kapitel ännu</p>
                  <p className="text-sm">
                    Använd automatisk uppdelning eller markera text manuellt
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {chapters.map((chapter) => (
                    <div key={chapter.id} className="border border-border rounded-lg p-4">
                      {editingChapterId === chapter.id ? (
                        <div className="space-y-3">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Kapiteltitel"
                          />
                          <Textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={8}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => updateChapter(chapter.id)} className="flex-1">
                              Spara
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingChapterId(null)}>
                              Avbryt
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between items-start mb-2">
                            <h3 className="font-semibold text-foreground">{chapter.title}</h3>
                            <div className="flex gap-1">
                              <button onClick={() => startEditing(chapter)} className="text-primary hover:text-primary/80 p-1">
                                <Pencil className="w-4 h-4" />
                              </button>
                              <label className="text-secondary hover:text-secondary/80 p-1 cursor-pointer">
                                <ImagePlus className="w-4 h-4" />
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) uploadImageToChapter(chapter.id, file);
                                  }}
                                />
                              </label>
                              <button onClick={() => deleteChapter(chapter.id)} className="text-destructive/60 hover:text-destructive p-1">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-3">
                            {chapter.content}
                          </p>
                          {chapter.images && chapter.images.length > 0 && (
                            <div className="flex gap-2 mt-3 flex-wrap">
                              {chapter.images.map((img) => (
                                <img
                                  key={img.id}
                                  src={img.url}
                                  alt={img.caption || ""}
                                  className="w-16 h-16 object-cover rounded border border-border"
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditBook;
