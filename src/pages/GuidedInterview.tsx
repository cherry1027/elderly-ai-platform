import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getThemeById } from "@/data/interviewQuestions";
import { useOpenAIRealtime, type RealtimeMessage } from "@/hooks/useOpenAIRealtime";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Mic, SkipForward, CheckCircle, Phone, PhoneOff, Pause, Play } from "lucide-react";
import { toast } from "sonner";

const GuidedInterview = () => {
  const { bookId, themeId } = useParams<{ bookId: string; themeId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const theme = themeId ? getThemeById(themeId) : undefined;
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [conversation, setConversation] = useState<RealtimeMessage[]>([]);
  const [hasStarted, setHasStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [skippedQuestions, setSkippedQuestions] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const questionIndexRef = useRef(0);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  // Keep ref in sync
  useEffect(() => {
    questionIndexRef.current = currentQuestionIndex;
  }, [currentQuestionIndex]);

  // Build system prompt
  const systemPrompt = theme
    ? `Du är Minna, en varm och empatisk AI-intervjuare som hjälper människor att berätta sin livshistoria på svenska.

DITT UPPDRAG:
Du intervjuar en person om temat "${theme.name}". Var genuint intresserad, varm och uppmuntrande.

REGLER:
- Prata ALLTID på svenska
- Var personlig och använd personens egna ord i dina svar
- Ställ en fråga i taget
- Ge kort bekräftelse (1-2 meningar) innan du ställer nästa fråga
- Ställ öppna följdfrågor, aldrig ja/nej-frågor
- Om personen ger ett kort svar, uppmuntra dem att berätta mer
- Om personen säger att de vill hoppa över en fråga, gå vidare utan att döma
- Var aldrig dömande
- Variera dina svar och bekräftelser, upprepa inte samma fraser

BÖRJA MED att presentera dig kort och ställ sedan denna första fråga:
"${theme.questions[0].question}"

PLANERADE FRÅGOR (ställ dem i ordning, men ställ relevanta följdfrågor emellan):
${theme.questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}

När alla frågor besvarats, avsluta med att tacka personen varmt för att de delat sina minnen.`
    : "";

  const addMessage = useCallback((role: RealtimeMessage["role"], content: string, type?: RealtimeMessage["type"]) => {
    setConversation(prev => [...prev, {
      role,
      content,
      type,
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  const handleUserTranscript = useCallback((text: string) => {
    addMessage("user", text);
    if (theme && bookId) {
      const currentQ = theme.questions[questionIndexRef.current];
      supabase.from("interview_turns" as any).insert({
        book_id: bookId,
        theme_id: themeId,
        question_id: currentQ.id,
        question_text: currentQ.question,
        user_answer: text,
      } as any).then(({ error }) => {
        if (error) console.error("Save turn error:", error);
      });
    }
  }, [theme, bookId, themeId, addMessage]);

  const handleMinnaText = useCallback((text: string) => {
    addMessage("minna", text);
  }, [addMessage]);

  const handleMinnaAudioStart = useCallback(() => {}, []);
  const handleMinnaAudioEnd = useCallback(() => {}, []);
  const handleError = useCallback((err: string) => {
    toast.error(err);
  }, []);

  const {
    connect,
    disconnect,
    sendTextMessage,
    isConnected,
    isConnecting,
    isMinnaSpeaking,
    isUserSpeaking,
  } = useOpenAIRealtime({
    systemPrompt,
    onUserTranscript: handleUserTranscript,
    onMinnaText: handleMinnaText,
    onMinnaAudioStart: handleMinnaAudioStart,
    onMinnaAudioEnd: handleMinnaAudioEnd,
    onError: handleError,
  });

  const startInterview = async () => {
    setHasStarted(true);
    await connect();
  };

  const handlePause = () => {
    disconnect();
    setIsPaused(true);
    toast.info("Intervjun är pausad. Allt är sparat – du kan fortsätta senare.");
  };

  const handleResume = async () => {
    setIsPaused(false);
    await connect();
    // Tell Minna to pick up where we left off
    const lastUserMsg = [...conversation].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      sendTextMessage(
        `Välkommen tillbaka! Vi pratade senast om detta tema. Användaren sa senast: "${lastUserMsg.content}". Fortsätt där vi slutade och ställ nästa fråga.`
      );
    }
  };

  const handlePauseAndExit = () => {
    disconnect();
    toast.success("Intervjun är sparad. Du kan fortsätta den när som helst.");
    navigate(`/dashboard`);
  };

  const skipQuestion = () => {
    if (!theme) return;
    const currentQ = theme.questions[currentQuestionIndex];
    setSkippedQuestions(prev => new Set(prev).add(currentQ.id));

    if (currentQuestionIndex < theme.questions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      const nextQ = theme.questions[nextIdx];
      sendTextMessage(`Användaren vill hoppa över denna fråga. Gå vidare till nästa: "${nextQ.question}"`);
    } else {
      finishInterview();
    }
  };

  const nextQuestion = () => {
    if (!theme) return;
    if (currentQuestionIndex < theme.questions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      const nextQ = theme.questions[nextIdx];
      sendTextMessage(`Gå vidare till nästa fråga: "${nextQ.question}"`);
    } else {
      finishInterview();
    }
  };

  const finishInterview = async () => {
    disconnect();
    toast.info("Strukturerar ditt kapitel...");

    try {
      const userAnswers = conversation
        .filter(m => m.role === "user")
        .map((m, i) => `Svar ${i + 1}: ${m.content}`)
        .join("\n\n");

      const res = await supabase.functions.invoke("minna-interview", {
        body: {
          action: "structure",
          interviewText: userAnswers,
          themeName: theme?.name || "Kapitel",
        },
      });

      if (res.error) throw res.error;

      const { title, content } = res.data;

      const { data: existingPages } = await supabase
        .from("pages")
        .select("chapter_number")
        .eq("book_id", bookId!)
        .order("chapter_number", { ascending: false })
        .limit(1);

      const nextChapterNum = ((existingPages?.[0]?.chapter_number) || 0) + 1;

      await supabase.from("pages").insert({
        book_id: bookId!,
        title: title || theme?.name,
        content: content || userAnswers,
        chapter_number: nextChapterNum,
        page_number: nextChapterNum,
      });

      await supabase
        .from("books")
        .update({ page_count: nextChapterNum, updated_at: new Date().toISOString() })
        .eq("id", bookId!);

      toast.success("Kapitel skapat från intervjun!");
      setTimeout(() => navigate(`/bok/${bookId}`), 2000);
    } catch (err) {
      console.error("Structuring error:", err);
      toast.error("Kunde inte strukturera kapitlet");
      navigate(`/bok/${bookId}`);
    }
  };

  const progress = theme ? ((currentQuestionIndex + 1) / theme.questions.length) * 100 : 0;
  const userAnswerCount = conversation.filter(m => m.role === "user").length;

  if (!theme) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Temat hittades inte.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => { disconnect(); navigate(`/bok/${bookId}`); }} className="text-muted-foreground hover:text-foreground">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <span className="text-3xl">{theme.icon}</span>
              <div>
                <h1 className="text-lg font-serif font-semibold text-foreground">{theme.name}</h1>
                <p className="text-xs text-muted-foreground">
                  Fråga {currentQuestionIndex + 1} av {theme.questions.length}
                  {skippedQuestions.size > 0 && ` • ${skippedQuestions.size} överhoppade`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isConnected && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-xs text-muted-foreground">Live</span>
                </div>
              )}
              {isPaused && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span className="text-xs text-primary font-medium">Pausad</span>
                </div>
              )}
            </div>
          </div>
          <Progress value={progress} className="mt-3 h-2" />
        </div>
      </header>

      {/* Question overview sidebar - compact */}
      {hasStarted && !isPaused && (
        <div className="bg-card/50 border-b border-border">
          <div className="max-w-4xl mx-auto px-4 py-2">
            <div className="flex gap-2 overflow-x-auto scrollbar-hide">
              {theme.questions.map((q, i) => (
                <button
                  key={q.id}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                    i === currentQuestionIndex
                      ? "bg-primary text-primary-foreground"
                      : skippedQuestions.has(q.id)
                      ? "bg-muted text-muted-foreground line-through"
                      : i < currentQuestionIndex
                      ? "bg-secondary/10 text-secondary"
                      : "bg-muted text-muted-foreground"
                  }`}
                  title={q.question}
                >
                  {i < currentQuestionIndex && !skippedQuestions.has(q.id) ? "✓" : ""} {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 pb-48">
        {!hasStarted ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-20">
            <span className="text-6xl">{theme.icon}</span>
            <h2 className="text-2xl font-serif font-semibold text-foreground">{theme.name}</h2>
            <p className="text-muted-foreground max-w-md">
              Minna kommer att intervjua dig med röst om detta tema.
              Du pratar och hon lyssnar, ställer följdfrågor och guidar dig genom berättelsen.
            </p>
            <div className="bg-card rounded-xl border border-border p-4 max-w-sm text-left space-y-2">
              <p className="text-sm font-medium text-foreground">💡 Tips innan du börjar:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Hitta en lugn plats att prata ostört</li>
                <li>• Du kan pausa och fortsätta senare</li>
                <li>• Hoppa över frågor som inte passar</li>
                <li>• Det finns inga rätt eller fel svar</li>
              </ul>
            </div>
            <Button
              onClick={startInterview}
              size="lg"
              className="gap-2 text-lg px-8 py-6"
              disabled={isConnecting}
            >
              <Phone className="w-5 h-5" />
              {isConnecting ? "Ansluter..." : "Starta intervju"}
            </Button>
          </div>
        ) : isPaused ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-20">
            <Pause className="w-16 h-16 text-primary" />
            <h2 className="text-2xl font-serif font-semibold text-foreground">Intervjun är pausad</h2>
            <p className="text-muted-foreground max-w-md">
              Allt du har sagt hittills är sparat. Du kan fortsätta nu eller komma tillbaka senare.
            </p>
            <p className="text-sm text-muted-foreground">
              Framsteg: Fråga {currentQuestionIndex + 1} av {theme.questions.length} • {userAnswerCount} svar sparade
            </p>
            <div className="flex gap-4">
              <Button onClick={handleResume} size="lg" className="gap-2">
                <Play className="w-5 h-5" />
                Fortsätt nu
              </Button>
              <Button variant="outline" size="lg" onClick={handlePauseAndExit}>
                Spara & avsluta
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {conversation.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "minna" && (
                  <div className="flex-shrink-0 mr-3">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-serif text-sm font-bold">
                      M
                    </div>
                  </div>
                )}

                <div
                  className={`max-w-[75%] rounded-2xl px-5 py-3 shadow-sm ${
                    msg.role === "user"
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-card border-2 border-primary/30"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    {new Date(msg.timestamp).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                {msg.role === "user" && (
                  <div className="flex-shrink-0 ml-3">
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground text-sm">
                      👤
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Speaking indicators */}
            {isMinnaSpeaking && (
              <div className="flex justify-start">
                <div className="flex-shrink-0 mr-3">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-serif text-sm font-bold animate-pulse">
                    M
                  </div>
                </div>
                <div className="bg-muted rounded-2xl px-5 py-3">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Controls */}
      {hasStarted && isConnected && !isPaused && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border shadow-lg">
          <div className="max-w-4xl mx-auto px-4 py-4">
            <div className="flex flex-col items-center gap-3">
              {/* Voice status */}
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${
                isUserSpeaking
                  ? "bg-destructive/10 border border-destructive/30"
                  : isMinnaSpeaking
                  ? "bg-primary/10 border border-primary/30"
                  : "bg-muted border border-border"
              }`}>
                {isUserSpeaking ? (
                  <>
                    <Mic className="w-5 h-5 text-destructive animate-pulse" />
                    <span className="text-sm font-medium text-destructive">Du pratar...</span>
                  </>
                ) : isMinnaSpeaking ? (
                  <>
                    <span className="text-sm">🎙️</span>
                    <span className="text-sm font-medium text-primary">Minna pratar...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Lyssnar...</span>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {userAnswerCount > 0 && (
                  <>
                    <Button onClick={skipQuestion} variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                      <SkipForward className="w-4 h-4" />
                      Hoppa över
                    </Button>
                    <Button onClick={nextQuestion} variant="outline" size="sm" className="gap-1">
                      {currentQuestionIndex < theme.questions.length - 1 ? (
                        <>Nästa fråga</>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          Avsluta tema
                        </>
                      )}
                    </Button>
                  </>
                )}
                <Button onClick={handlePause} variant="outline" size="sm" className="gap-1">
                  <Pause className="w-4 h-4" />
                  Pausa
                </Button>
                <Button
                  onClick={() => { disconnect(); navigate(`/bok/${bookId}/edit`); }}
                  variant="destructive"
                  size="sm"
                  className="gap-1"
                >
                  <PhoneOff className="w-4 h-4" />
                  Avsluta
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GuidedInterview;
