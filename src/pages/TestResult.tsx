import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import { Loader2, Clock, BookOpen } from "lucide-react";

interface StructuredSection {
  heading: string;
  text: string;
}

interface StructuredChapter {
  title: string;
  sections: StructuredSection[];
}

const themeLabels: Record<string, string> = {
  childhood: "Barndom & Uppväxt",
  family: "Familj & Relationer",
  career: "Arbete & Studier",
  milestones: "Viktiga Ögonblick",
  wisdom: "Visdom & Lärdomar",
};

const TestResult = () => {
  const navigate = useNavigate();
  const [audioURL, setAudioURL] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [rawTranscript, setRawTranscript] = useState("");
  const [chapter, setChapter] = useState<StructuredChapter | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isStructuring, setIsStructuring] = useState(false);
  const [error, setError] = useState("");

  const theme = localStorage.getItem("testTheme") || "childhood";
  const personName = localStorage.getItem("testPersonName") || "du";
  const themeLabel = themeLabels[theme] || "Barndom & Uppväxt";

  useEffect(() => {
    // Load transcript from guided conversation (new flow)
    const transcript = localStorage.getItem("testTranscript");
    if (transcript) {
      setRawTranscript(transcript);
    } else {
      // Fallback: try old audio-based flow
      const audio = localStorage.getItem("testAudio");
      if (audio) setAudioURL(audio);
    }

    const imgs = localStorage.getItem("testImages");
    if (imgs) {
      try { setImages(JSON.parse(imgs)); } catch { /* ignore */ }
    }
  }, []);

  // Transcribe audio only if no transcript from guided conversation
  useEffect(() => {
    if (audioURL && !rawTranscript && !isTranscribing) {
      transcribeAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioURL]);

  // Structure with AI once transcript is ready
  useEffect(() => {
    if (rawTranscript && !chapter && !isStructuring) {
      structureText();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTranscript]);

  const transcribeAudio = async () => {
    setIsTranscribing(true);
    try {
      const response = await fetch(audioURL);
      const audioBlob = await response.blob();
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const result = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-transcribe`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: formData,
        }
      );

      if (!result.ok) {
        console.error("Transcription failed:", await result.text());
        setError("Kunde inte transkribera inspelningen.");
        return;
      }

      const data = await result.json();
      setRawTranscript(data.text || "");
    } catch (err) {
      console.error("Transcription error:", err);
      setError("Ett fel uppstod vid transkribering.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const structureText = async () => {
    setIsStructuring(true);
    try {
      const result = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/minna-interview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            action: "structure-test",
            interviewText: rawTranscript,
            themeName: themeLabel,
            personName: personName,
          }),
        }
      );

      if (!result.ok) {
        console.error("Structuring failed:", await result.text());
        // Fallback: show raw text as single section
        setChapter({
          title: themeLabel,
          sections: [{ heading: "", text: rawTranscript }],
        });
        return;
      }

      const data = await result.json();
      setChapter(data);
    } catch (err) {
      console.error("Structuring error:", err);
      setChapter({
        title: themeLabel,
        sections: [{ heading: "", text: rawTranscript }],
      });
    } finally {
      setIsStructuring(false);
    }
  };

  const isLoading = isTranscribing || isStructuring;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      {/* Progress */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>Steg 3 av 3</span>
            <span>Din berättelse</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-full rounded-full bg-secondary transition-all" style={{ width: "100%" }} />
          </div>
        </div>
      </div>

      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-2xl">

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <BookOpen className="h-16 w-16 text-primary/20" />
                <Loader2 className="h-8 w-8 animate-spin text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="mt-6 font-serif text-xl text-foreground">
                {isTranscribing ? "Transkriberar din berättelse…" : "Strukturerar med rubriker…"}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {isTranscribing ? "Minna lyssnar noga på allt du sa" : "Minna skapar kapitel och rubriker åt dig"}
              </p>
            </div>
          )}

          {/* Error */}
          {error && !isLoading && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-6 text-center">
              <p className="text-destructive font-medium">{error}</p>
            </div>
          )}

          {/* Empty state — no transcript captured */}
          {!isLoading && !error && !chapter && !rawTranscript && !audioURL && (
            <div className="rounded-xl bg-card border border-border p-8 text-center space-y-4">
              <span className="text-5xl">🎙️</span>
              <h2 className="font-serif text-2xl font-bold text-foreground">
                Vi fångade tyvärr inget från samtalet
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                Det kan bero på att mikrofonen inte var aktiverad eller att samtalet avslutades innan något hann sägas. Vill du försöka igen?
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => navigate("/test")}
                  className="rounded-full bg-secondary px-8 py-3 font-semibold text-secondary-foreground shadow hover:bg-secondary/90 transition"
                >
                  Försök igen
                </button>
                <button
                  onClick={() => navigate("/")}
                  className="rounded-full border-2 border-border bg-card px-8 py-3 font-semibold text-foreground hover:bg-muted transition"
                >
                  Tillbaka till start
                </button>
              </div>
            </div>
          )}

          {/* Book preview */}
          {chapter && !isLoading && (
            <>
              {/* The book page */}
              <div className="relative bg-card rounded-sm shadow-[0_4px_30px_rgba(0,0,0,0.12)] overflow-hidden mb-10">
                {/* Watermark */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.04] z-10">
                  <span className="text-6xl font-serif font-bold rotate-[-25deg] select-none text-foreground whitespace-nowrap">
                    DEMO — Minaminnen.se
                  </span>
                </div>

                {/* Book spine shadow effect */}
                <div className="absolute left-0 top-0 bottom-0 w-2 bg-gradient-to-r from-foreground/5 to-transparent" />

                {/* Content */}
                <div className="px-8 py-12 md:px-16 md:py-16">
                  {/* Chapter number & theme */}
                  <p className="text-xs tracking-[0.3em] uppercase text-muted-foreground mb-4">
                    Kapitel 1
                  </p>

                  {/* Chapter title */}
                  <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-2 leading-tight">
                    {chapter.title}
                  </h1>

                  {/* Decorative divider */}
                  <div className="flex items-center gap-3 my-8">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-primary text-lg">✦</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  {/* Image placed artistically if available */}
                  {images.length > 0 && (
                    <figure className="float-right ml-6 mb-4 w-[45%] max-w-[240px]">
                      <img
                        src={images[0]}
                        alt="Foto"
                        className="w-full rounded-lg shadow-md"
                      />
                      <figcaption className="mt-2 text-xs text-muted-foreground italic text-center">
                        {personName !== "du" ? `${personName}` : "Ett minne i bild"}
                      </figcaption>
                    </figure>
                  )}

                  {/* Structured text with headings */}
                  {chapter.sections.map((section, i) => (
                    <div key={i} className="mb-8">
                      {section.heading && (
                        <h2 className="font-serif text-xl font-semibold text-foreground mb-3 mt-6">
                          {section.heading}
                        </h2>
                      )}
                      <div className="text-foreground/90 leading-[1.9] text-[15px] font-light whitespace-pre-line">
                        {section.text}
                      </div>
                    </div>
                  ))}

                  {/* Page number */}
                  <div className="mt-12 text-center">
                    <span className="text-xs text-muted-foreground">— 1 —</span>
                  </div>
                </div>
              </div>

              {/* Audio playback */}
              {audioURL && (
                <div className="bg-card rounded-xl border border-border p-5 mb-6">
                  <p className="text-sm font-medium text-foreground mb-3">🎙️ Lyssna på originalinspelningen</p>
                  <audio src={audioURL} controls className="w-full" />
                </div>
              )}

              {/* 24h notice */}
              <div className="flex items-start gap-3 rounded-xl bg-primary/5 border border-primary/15 p-5 mb-10">
                <Clock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Din session raderas om 24 timmar
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Registrera dig gratis för att spara din berättelse permanent och fortsätta skriva.
                  </p>
                </div>
              </div>

              {/* CTA section */}
              <div className="text-center py-8 space-y-6">
                <p className="text-3xl mb-1">🎉</p>
                <h2 className="font-serif text-2xl font-bold text-foreground">
                  Fantastiskt{personName !== "du" ? `, ${personName}` : ""}!
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Så här kan din minnesskatt se ut. Skapa ett gratis konto för att spara den här berättelsen och fortsätta med fler kapitel.
                </p>

                {/* What you get */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto text-left">
                  <div className="bg-card rounded-xl border border-border p-4">
                    <p className="text-lg mb-1">📖</p>
                    <p className="text-sm font-medium text-foreground">Spara din bok</p>
                    <p className="text-xs text-muted-foreground">Berättelsen sparas permanent</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4">
                    <p className="text-lg mb-1">🎙️</p>
                    <p className="text-sm font-medium text-foreground">Fler kapitel</p>
                    <p className="text-xs text-muted-foreground">Spela in obegränsat</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4">
                    <p className="text-lg mb-1">🖨️</p>
                    <p className="text-sm font-medium text-foreground">Beställ tryck</p>
                    <p className="text-xs text-muted-foreground">Få en fysisk bok</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                  <button
                    onClick={() => navigate("/registrera")}
                    className="rounded-full bg-secondary px-10 py-4 text-lg font-semibold text-secondary-foreground shadow-lg hover:bg-secondary/90 hover:scale-[1.02] transition-all"
                  >
                    Skapa konto — gratis
                  </button>
                  <button
                    onClick={() => navigate("/#priser")}
                    className="rounded-full border-2 border-border bg-card px-10 py-4 text-lg font-semibold text-foreground hover:bg-muted transition"
                  >
                    Se Premium
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Helt gratis att komma igång • Uppgradera när du vill
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="py-4 text-center text-sm text-muted-foreground border-t border-border">
        Skapad med ❤️ av Mina Minnen
      </footer>
    </div>
  );
};

export default TestResult;
