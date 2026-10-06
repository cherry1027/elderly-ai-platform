import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, Phone, PhoneOff, SkipForward, Volume2 } from "lucide-react";
import { useOpenAIRealtime, type RealtimeMessage } from "@/hooks/useOpenAIRealtime";
import { getThemeById } from "@/data/interviewQuestions";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import Header from "@/components/Header";
import { toast } from "sonner";

const MAX_SECONDS = 300; // 5 minutes

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const TestRecording = () => {
  const navigate = useNavigate();
  const themeId = localStorage.getItem("testTheme") || "open";
  const theme = themeId === "open" ? null : getThemeById(themeId);
  const personName = localStorage.getItem("testPersonName") || "du";

  const [hasStarted, setHasStarted] = useState(false);
  const [conversation, setConversation] = useState<RealtimeMessage[]>([]);
  const [timeLeft, setTimeLeft] = useState(MAX_SECONDS);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const questionIndexRef = useRef(0);

  useEffect(() => {
    questionIndexRef.current = currentQuestionIndex;
  }, [currentQuestionIndex]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  // Build system prompt for test mode
  const nameContext = personName && personName !== "du" ? ` om ${personName}` : "";
  const systemPrompt = `Du är Minna, en varm och empatisk AI-intervjuare som hjälper människor att berätta sin livshistoria på svenska.

DITT UPPDRAG:
Du har ett öppet samtal${nameContext} under en gratis 5-minuterstest. Du leder samtalet och hjälper personen hitta in i berättelsen genom att börja brett och följa med dit deras minnen leder.

REGLER:
- Prata ALLTID på svenska
- Var personlig, varm och uppmuntrande
- Ställ EN fråga i taget
- Ge en kort bekräftelse (1-2 meningar) innan du ställer nästa fråga
- Ställ ALLTID öppna följdfrågor, aldrig ja/nej-frågor
- Om personen ger ett kort svar — be dem utveckla med en specifik följdfråga ("Hur kändes det?", "Berätta mer om...", "Kan du beskriva det?")
- Var nyfiken och konkret — fråga om dofter, ljud, känslor, personer, platser
- Var aldrig dömande
- Variera dina bekräftelser så det inte låter mekaniskt

GE TID ATT TÄNKA (mycket viktigt):
- Avbryt ALDRIG. Vänta tills personen verkligen är klar med sin tanke.
- Om personen tystnar kort (några sekunder) — vänta lugnt, det är ofta en paus för att tänka, inte ett slut.
- Stressa inte fram nästa fråga. Korta tystnader är en del av berättandet.
- Om personen tvekar eller säger "hmm", ge dem utrymme – fyll inte i åt dem.
- Tala lugnt och i lite långsammare tempo än normalt, så det känns tryggt att svara.

VIKTIGT OM TID:
- Ni har 5 minuter tillsammans. AVSLUTA INTE samtalet i förtid.
- Fortsätt ställa följdfrågor och fördjupa berättelsen så länge tiden räcker.
- Du får systemmeddelande när 1 minut återstår — då avrundar du varmt.
- Avsluta ALDRIG samtalet själv förrän du fått instruktion om att tiden är slut.

BÖRJA DIREKT när samtalet startar – vänta inte på att personen säger något först. Hälsa kort: "Hej! Jag heter Minna och jag är så glad att du vill berätta${nameContext ? ` ${nameContext}` : ""}! Vi har fem minuter tillsammans. Ta gärna god tid på dig att tänka innan du svarar."

Ställ sedan en BRED, ÖPPEN startfråga – välj en som känns naturlig, t.ex.:
- "Vill du börja med att berätta lite om dig själv – var växte du upp?"
- "Finns det ett minne som dykt upp i tankarna på sistone som du skulle vilja dela?"
- "Om du blickar tillbaka på ditt liv – vad är det första som kommer upp?"

Lyssna sedan tålmodigt på vad personen säger och följ den tråd som dyker upp. Fördjupa med följdfrågor om sinnesintryck, känslor och personer innan du går vidare till nya områden (barndom, familj, arbete, viktiga ögonblick, lärdomar).`;


  const addMessage = useCallback((role: RealtimeMessage["role"], content: string) => {
    setConversation(prev => [...prev, {
      role,
      content,
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  const handleUserTranscript = useCallback((text: string) => {
    addMessage("user", text);
  }, [addMessage]);

  const handleMinnaText = useCallback((text: string) => {
    addMessage("minna", text);
  }, [addMessage]);

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
    onMinnaAudioStart: useCallback(() => {}, []),
    onMinnaAudioEnd: useCallback(() => {}, []),
    onError: handleError,
  });

  // Timer logic
  useEffect(() => {
    if (hasStarted && isConnected && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            finishInterview();
            return 0;
          }
          // Warning at 1 minute left
          if (prev === 60) {
            sendTextMessage("Det är en minut kvar av vår tid. Låt oss avrunda med en sista tanke.");
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStarted, isConnected]);

  const startInterview = async () => {
    setHasStarted(true);
    await connect();
  };

  const skipQuestion = () => {
    sendTextMessage("Användaren vill byta spår. Tacka kort och ställ en ny, bred följdfråga om ett annat område av deras liv.");
  };

  const finishInterview = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    disconnect();

    // Save conversation to localStorage for structuring in TestResult
    setConversation(prev => {
      // Build a readable transcript of the whole conversation (Minna + user)
      const fullTranscript = prev
        .map(m => `${m.role === "user" ? "Berättaren" : "Minna"}: ${m.content}`)
        .join("\n\n");
      const userOnly = prev
        .filter(m => m.role === "user")
        .map(m => m.content)
        .join("\n\n");
      // Prefer user-only text, but fall back to full transcript so result page never blanks out
      localStorage.setItem("testTranscript", userOnly.trim() || fullTranscript);
      localStorage.setItem("testConversation", JSON.stringify(prev));
      return prev;
    });

    toast.success("Samtalet är klart! Nu kan du lägga till ett foto.");
    setTimeout(() => navigate("/test-ladda-upp"), 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disconnect, navigate]);

  const elapsed = MAX_SECONDS - timeLeft;
  const progressPercent = (elapsed / MAX_SECONDS) * 100;
  const userAnswerCount = conversation.filter(m => m.role === "user").length;

  const displayIcon = theme?.icon ?? "💬";
  const displayName = theme?.name ?? "Öppet samtal";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      {/* Progress bar */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="mx-auto max-w-xl">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>Steg 1 av 3</span>
            <span>Samtal med Minna</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-full rounded-full bg-secondary transition-all" style={{ width: "33%" }} />
          </div>
        </div>
      </div>

      {/* Timer + theme badge */}
      {hasStarted && (
        <div className="bg-card/50 border-b border-border">
          <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{displayIcon}</span>
              <span className="text-sm font-medium text-foreground">{displayName}</span>
              {personName !== "du" && (
                <span className="text-sm text-muted-foreground">• {personName}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isConnected && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                  <span className="text-xs text-muted-foreground">Live</span>
                </div>
              )}
              <div className={`font-mono text-sm font-semibold px-3 py-1 rounded-full ${
                timeLeft <= 60 ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
              }`}>
                {formatTime(timeLeft)}
              </div>
            </div>
          </div>
          <div className="max-w-xl mx-auto px-4 pb-2">
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 max-w-xl mx-auto w-full px-4 py-6 pb-48">
        {!hasStarted ? (
          /* Pre-start screen */
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-16">
            <span className="text-6xl">{displayIcon}</span>
            <h1 className="text-3xl font-serif font-bold text-foreground">{displayName}</h1>
            <p className="text-muted-foreground max-w-md">
              Minna kommer att intervjua dig med röst{nameContext}. Du pratar och hon lyssnar, ställer öppna följdfrågor och guidar dig genom berättelsen.
            </p>

            {/* Timer info */}
            <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/15 px-5 py-3">
              <span className="text-2xl">⏱️</span>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">5 minuters samtal</p>
                <p className="text-xs text-muted-foreground">Minna börjar brett och följer din berättelse</p>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-4 max-w-sm text-left space-y-2">
              <p className="text-sm font-medium text-foreground">💡 Tips innan du börjar:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Hitta en lugn plats att prata ostört</li>
                <li>• Tillåt mikrofon-åtkomst i webbläsaren</li>
                <li>• Det finns inga rätt eller fel svar</li>
                <li>• Berätta så mycket eller lite du vill</li>
              </ul>
            </div>

            <Button
              onClick={startInterview}
              size="lg"
              className="gap-2 text-lg px-8 py-6 mt-2"
              disabled={isConnecting}
            >
              <Phone className="w-5 h-5" />
              {isConnecting ? "Ansluter till Minna..." : "Starta samtalet"}
            </Button>
            <p className="text-xs text-muted-foreground">Ingen registrering krävs</p>
          </div>
        ) : (
          /* Conversation view */
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
                <div className={`max-w-[75%] rounded-2xl px-5 py-3 shadow-sm ${
                  msg.role === "user"
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-card border-2 border-primary/30"
                }`}>
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

            {/* Speaking indicator */}
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

      {/* Bottom controls */}
      {hasStarted && isConnected && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border shadow-lg">
          <div className="max-w-xl mx-auto px-4 py-4">
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
                    <Volume2 className="w-5 h-5 text-primary animate-pulse" />
                    <span className="text-sm font-medium text-primary">Minna pratar...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Minna lyssnar...</span>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {userAnswerCount > 0 && (
                  <Button onClick={skipQuestion} variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                    <SkipForward className="w-4 h-4" />
                    Hoppa över
                  </Button>
                )}
                <Button
                  onClick={finishInterview}
                  variant="outline"
                  size="sm"
                  className="gap-1"
                >
                  <PhoneOff className="w-4 h-4" />
                  Avsluta samtalet
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TestRecording;
