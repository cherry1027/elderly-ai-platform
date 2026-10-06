import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, Square, CheckCircle2, XCircle, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

const MAX_RECORDING_TIME = 60 * 60; // 60 min freemium
const FREEMIUM_DELETION_DAYS = 90;

const subjectOptions = [
  { id: "myself", label: "Mig själv", icon: "🙋" },
  { id: "mother", label: "Min mor", icon: "👩" },
  { id: "father", label: "Min far", icon: "👨" },
  { id: "grandmother_m", label: "Min mormor", icon: "👵" },
  { id: "grandfather_m", label: "Min morfar", icon: "👴" },
  { id: "grandmother_f", label: "Min farmor", icon: "👵" },
  { id: "grandfather_f", label: "Min farfar", icon: "👴" },
  { id: "other", label: "Någon annan", icon: "✨" },
];

const CreateBook = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);

  // Step 1 - Subject
  const [selectedSubject, setSelectedSubject] = useState("myself");
  const [customSubject, setCustomSubject] = useState("");
  const [personName, setPersonName] = useState("");

  // Step 2 - Title
  const [bookTitle, setBookTitle] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);

  // Step 3 - Recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 4 - Transcription
  const [transcriptionStatus, setTranscriptionStatus] = useState<"idle" | "processing" | "completed" | "failed">("idle");
  const [transcriptionText, setTranscriptionText] = useState("");

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-generate title suggestion
  useEffect(() => {
    if (step === 2 && !bookTitle) {
      const name = personName || (selectedSubject === "myself" ? user?.email?.split("@")[0] : "");
      if (name) {
        setBookTitle(`${name}s minnen`);
      }
    }
  }, [step, personName, selectedSubject, user, bookTitle]);

  const subjectLabel = selectedSubject === "other"
    ? customSubject
    : subjectOptions.find(s => s.id === selectedSubject)?.label || "";

  // ── Step 2: Create book ──
  async function handleCreateBook() {
    if (!bookTitle.trim()) {
      toast.error("Ange en titel för din bok");
      return;
    }
    if (!user) return;

    try {
      const { data: existing } = await supabase
        .from("books")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "draft")
        .maybeSingle();

      if (existing) {
        toast.error("Du kan bara ha en aktiv bok i Freemium. Slutför eller radera din nuvarande bok först.");
        return;
      }

      const scheduledDeletion = new Date();
      scheduledDeletion.setDate(scheduledDeletion.getDate() + FREEMIUM_DELETION_DAYS);

      const description = `Boken handlar om: ${subjectLabel}${personName ? ` (${personName})` : ""}`;

      // Demo users (redeemed invite code) get Premium books automatically.
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_demo_premium")
        .eq("user_id", user.id)
        .maybeSingle();
      const isDemoPremium = !!profile?.is_demo_premium;

      const { data, error } = await supabase
        .from("books")
        .insert({
          user_id: user.id,
          title: bookTitle,
          description,
          plan_type: isDemoPremium ? "premium" : "freemium",
          scheduled_deletion: isDemoPremium ? null : scheduledDeletion.toISOString(),
        })
        .select()
        .single();


      if (error) throw error;
      setBookId(data.id);
      setStep(3);
    } catch (err: any) {
      console.error("Error creating book:", err);
      toast.error("Kunde inte skapa bok: " + err.message);
    }
  }

  // ── Step 3: Recording ──
  async function startRecording() {
    try {
      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/mp4";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setAudioURL(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= MAX_RECORDING_TIME) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      toast.error("Kunde inte starta mikrofon: " + err.message);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  function resetRecording() {
    setAudioBlob(null);
    setAudioURL(null);
    setRecordingTime(0);
  }

  // ── Step 4: Transcription ──
  async function startTranscription() {
    if (!audioBlob || !bookId) return;

    setStep(4);
    setTranscriptionStatus("processing");

    try {
      const formData = new FormData();
      formData.append("audio", new File([audioBlob], "recording.webm", { type: audioBlob.type }));
      formData.append("bookId", bookId);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/transcribe-long-audio`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: formData,
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setTranscriptionText(result.text);
      setTranscriptionStatus("completed");
      toast.success("Transkribering klar!");
    } catch (err: any) {
      console.error("Transcription error:", err);
      setTranscriptionStatus("failed");
      toast.error("Transkribering misslyckades: " + err.message);
    }
  }

  function formatTime(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  const totalSteps = 4;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-10 max-w-3xl">
        {/* Progress steps */}
        <div className="mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    step >= s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {step > s ? "✓" : s}
                </div>
                {s < totalSteps && (
                  <div className={`w-12 h-0.5 ${step > s ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground max-w-sm mx-auto">
            <span>Om boken</span>
            <span>Titel</span>
            <span>Inspelning</span>
            <span>Klar</span>
          </div>
        </div>

        {/* Step 1: Who is the book about? */}
        {step === 1 && (
          <div className="bg-card rounded-2xl shadow-sm p-8">
            <h2 className="font-serif text-3xl font-bold text-card-foreground mb-2">
              Skapa din bok 📖
            </h2>
            <p className="text-muted-foreground mb-8">
              Berätta vem boken handlar om
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-3">
                  Den här boken handlar om:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {subjectOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setSelectedSubject(option.id)}
                      className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                        selectedSubject === option.id
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-background hover:border-primary/40"
                      }`}
                    >
                      <span className="text-xl">{option.icon}</span>
                      <span className="text-sm font-medium text-foreground">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {selectedSubject === "other" && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Vem är det?
                  </label>
                  <Input
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder="T.ex. Min bästa vän, Min moster"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Personens namn (valfritt)
                </label>
                <Input
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder='T.ex. "Ingrid" eller "Mormor Karin"'
                />
              </div>

              <Button
                onClick={() => setStep(2)}
                className="w-full gap-2"
                size="lg"
                disabled={selectedSubject === "other" && !customSubject.trim()}
              >
                Fortsätt
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Title */}
        {step === 2 && (
          <div className="bg-card rounded-2xl shadow-sm p-8">
            <h2 className="font-serif text-3xl font-bold text-card-foreground mb-2">
              Ge din bok en titel
            </h2>
            <p className="text-muted-foreground mb-8">
              Du kan alltid ändra titeln senare
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Boktitel</label>
                <Input
                  value={bookTitle}
                  onChange={(e) => setBookTitle(e.target.value)}
                  placeholder="T.ex. Mormors berättelser"
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Tips: Du kan ändra titeln när som helst
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                  ← Tillbaka
                </Button>
                <Button onClick={handleCreateBook} className="flex-1 gap-2" size="lg">
                  Fortsätt till inspelning
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Recording */}
        {step === 3 && (
          <div className="bg-card rounded-2xl shadow-sm p-8">
            <h2 className="font-serif text-3xl font-bold text-card-foreground mb-2">
              Spela in din berättelse
            </h2>
            <p className="text-muted-foreground mb-8">
              Tala fritt i upp till {MAX_RECORDING_TIME / 60} minuter. Du strukturerar innehållet efteråt!
            </p>

            <div className="bg-muted/30 rounded-xl p-10 mb-6">
              {!audioURL ? (
                <div className="text-center">
                  {!isRecording ? (
                    <>
                      <button
                        onClick={startRecording}
                        className="w-28 h-28 mx-auto bg-secondary hover:bg-secondary/90 rounded-full flex items-center justify-center transition-transform hover:scale-105 shadow-lg"
                      >
                        <Mic className="w-12 h-12 text-secondary-foreground" />
                      </button>
                      <p className="mt-6 text-foreground font-medium">Tryck för att börja spela in</p>
                      <p className="text-sm text-muted-foreground mt-2">Tips: Tala lugnt och tydligt</p>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={stopRecording}
                        className="w-28 h-28 mx-auto bg-destructive hover:bg-destructive/90 rounded-full flex items-center justify-center transition animate-pulse shadow-lg"
                      >
                        <Square className="w-10 h-10 text-destructive-foreground" />
                      </button>
                      <p className="mt-6 text-3xl font-mono text-destructive font-bold">
                        {formatTime(recordingTime)}
                      </p>
                      <p className="text-foreground font-medium mt-2">Tryck för att stoppa</p>
                      {recordingTime > MAX_RECORDING_TIME * 0.9 && (
                        <p className="text-destructive text-sm mt-4 animate-pulse">
                          ⚠️ Du närmar dig maxgränsen
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="bg-card rounded-lg p-6">
                    <div className="flex items-center gap-2 font-semibold mb-4 text-secondary">
                      <CheckCircle2 className="w-5 h-5" />
                      Inspelning klar!
                    </div>
                    <audio controls src={audioURL} className="w-full mb-2" />
                    <p className="text-sm text-muted-foreground">Längd: {formatTime(recordingTime)}</p>
                  </div>

                  <div className="flex gap-4">
                    <Button variant="outline" onClick={resetRecording} className="flex-1">
                      Spela in igen
                    </Button>
                    <Button onClick={startTranscription} className="flex-1 gap-2">
                      Fortsätt
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-accent/50 border border-border rounded-lg p-4 text-sm text-muted-foreground">
              💡 <strong>Tips:</strong> Berätta kronologiskt eller ämnesvis. Du delar upp i kapitel efteråt!
            </div>
          </div>
        )}

        {/* Step 4: Transcription */}
        {step === 4 && (
          <div className="bg-card rounded-2xl shadow-sm p-8">
            <h2 className="font-serif text-3xl font-bold text-card-foreground mb-6">
              Transkriberar din berättelse
            </h2>

            {transcriptionStatus === "processing" && (
              <div className="text-center py-16">
                <Loader2 className="w-16 h-16 mx-auto mb-6 text-primary animate-spin" />
                <p className="text-lg text-foreground">Omvandlar tal till text...</p>
                <p className="text-sm text-muted-foreground mt-2">Detta kan ta några minuter</p>
              </div>
            )}

            {transcriptionStatus === "completed" && (
              <div className="text-center py-10">
                <div className="w-20 h-20 bg-secondary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-secondary" />
                </div>
                <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">
                  Din berättelse är klar!
                </h3>
                <p className="text-muted-foreground mb-4">
                  Innehållet har transkriberats och strukturerats professionellt med AI.
                </p>
                {transcriptionText && (
                  <div className="bg-muted/30 rounded-lg p-4 mb-6 text-left max-h-48 overflow-y-auto">
                    <p className="text-sm text-muted-foreground italic line-clamp-6">{transcriptionText.slice(0, 500)}...</p>
                  </div>
                )}
                <Button size="lg" onClick={() => navigate(`/bok/${bookId}/edit`)} className="gap-2">
                  Börja redigera
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {transcriptionStatus === "failed" && (
              <div className="text-center py-10">
                <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-10 h-10 text-destructive" />
                </div>
                <h3 className="font-serif text-2xl font-semibold text-foreground mb-2">
                  Något gick fel
                </h3>
                <p className="text-muted-foreground mb-6">
                  Transkriberingen misslyckades. Försök igen.
                </p>
                <Button variant="outline" onClick={() => setStep(3)}>
                  ← Tillbaka till inspelning
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-center">
          <button onClick={() => navigate("/dashboard")} className="text-sm text-muted-foreground hover:text-foreground">
            ← Tillbaka till Dashboard
          </button>
        </div>
      </main>
    </div>
  );
};

export default CreateBook;
