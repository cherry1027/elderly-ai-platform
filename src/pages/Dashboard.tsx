import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Plus, Eye, LogOut, AlertTriangle, Crown, Mic, Clock, CreditCard, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import OnboardingGuide from "@/components/OnboardingGuide";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { INTERVIEW_THEMES, getAllThemes } from "@/data/interviewQuestions";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";

const FREEMIUM_LIMITS = { maxPages: 8, maxImages: 3, deletionDays: 120 };
const PREMIUM_LIMITS = { maxPages: 300, maxImages: 999, deletionDays: null };
const INACTIVITY_DELETION_DAYS = 120;

function getLimits(planType: string) {
  return planType === "premium" ? PREMIUM_LIMITS : FREEMIUM_LIMITS;
}

interface Book {
  id: string;
  title: string;
  description: string | null;
  status: string;
  plan_type: string;
  page_count: number;
  image_count: number;
  created_at: string;
  updated_at: string;
  last_edited: string;
  scheduled_deletion: string | null;
}

interface CompletedTheme {
  theme_id: string;
  count: number;
}

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [completedThemes, setCompletedThemes] = useState<CompletedTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { startCheckout, loading: checkoutLoading } = useStripeCheckout();

  const allThemes = getAllThemes();

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      const { data: bookData, error } = await supabase
        .from("books")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "draft")
        .maybeSingle();

      if (error) throw error;
      setBook(bookData);

      if (bookData) {
        const { data: turns } = await supabase
          .from("interview_turns")
          .select("theme_id")
          .eq("book_id", bookData.id);

        if (turns) {
          const themeMap = new Map<string, number>();
          turns.forEach(t => {
            themeMap.set(t.theme_id, (themeMap.get(t.theme_id) || 0) + 1);
          });
          setCompletedThemes(
            Array.from(themeMap.entries()).map(([theme_id, count]) => ({ theme_id, count }))
          );
        }
      }
    } catch (err) {
      console.error("Error loading data:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Check if onboarding should be shown
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && !(data as any).onboarding_completed) {
          setShowOnboarding(true);
        }
      });
  }, [user]);

  const createNewBook = () => {
    if (book && book.plan_type !== "premium") {
      alert("Du kan bara ha en aktiv bok i gratisversionen. Uppgradera till Premium eller slutför din nuvarande bok.");
      return;
    }
    navigate("/skapa-bok");
  };

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const limits = getLimits(book?.plan_type || "freemium");
  const isPremium = book?.plan_type === "premium";

  const daysInactive = book?.last_edited
    ? Math.floor((Date.now() - new Date(book.last_edited).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const daysUntilDeletion = !isPremium && book ? Math.max(0, INACTIVITY_DELETION_DAYS - daysInactive) : null;

  const getInactivityUrgency = () => {
    if (!daysUntilDeletion || isPremium) return null;
    if (daysUntilDeletion <= 5) return "critical";
    if (daysUntilDeletion <= 15) return "critical";
    if (daysUntilDeletion <= 30) return "urgent";
    if (daysUntilDeletion <= 45) return "warning";
    if (daysUntilDeletion <= 60) return "info";
    return null;
  };
  const inactivityUrgency = getInactivityUrgency();

  const getThemeStatus = (themeId: string) => {
    const completed = completedThemes.find(t => t.theme_id === themeId);
    if (!completed) return "pending";
    const theme = INTERVIEW_THEMES[themeId];
    if (completed.count >= (theme?.questions.length || 3)) return "completed";
    return "in_progress";
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      {showOnboarding && user && (
        <OnboardingGuide userId={user.id} onComplete={() => setShowOnboarding(false)} />
      )}
      <main className="flex-1 container mx-auto px-4 py-10 md:px-8">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="font-serif text-3xl font-bold text-foreground">Min bok</h1>
            <p className="mt-1 text-muted-foreground">
              {isPremium
                ? "✨ Premium – alla funktioner tillgängliga"
                : `Gratis: Max ${limits.maxPages} sidor, max ${limits.maxImages} bilder`}
            </p>
          </div>
          <Button variant="outline" onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            Logga ut
          </Button>
        </div>

        {book ? (
          <>
            <div className="rounded-2xl bg-card shadow-sm mb-6 overflow-hidden">
              {/* Book header */}
              <div className="p-8 pb-6 border-b border-border">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <BookOpen className="h-5 w-5 text-primary" />
                      <h3 className="font-serif text-2xl font-semibold text-card-foreground">{book.title}</h3>
                      {isPremium && (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          ✨ Premium
                        </span>
                      )}
                    </div>
                    {book.description && (
                      <p className="text-sm text-muted-foreground mb-1">{book.description}</p>
                    )}
                    <p className="text-muted-foreground">
                      {completedThemes.reduce((sum, t) => sum + t.count, 0)} svar inspelade · {book.page_count} / {limits.maxPages} sidor
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/bok/${book.id}/preview`)}>
                      <Eye className="h-3.5 w-3.5" />
                      Förhandsgranska
                    </Button>
                    <Button size="sm" className="gap-1.5" onClick={() => navigate(`/bok/${book.id}`)}>
                      <BookOpen className="h-3.5 w-3.5" />
                      Redigera
                    </Button>
                  </div>
                </div>
              </div>

              {/* Interview progress - integrated */}
              <div className="p-8 pt-6">
                <h4 className="font-serif text-lg font-semibold text-foreground mb-1">
                  Intervjuframsteg
                </h4>
                <p className="text-sm text-muted-foreground mb-5">
                  Välj ett tema att intervjua om – Minna guidar dig genom berättelsen
                </p>

                <div className="space-y-3">
                  {allThemes.map((theme) => {
                    const status = getThemeStatus(theme.id);
                    const completedCount = completedThemes.find(t => t.theme_id === theme.id)?.count || 0;

                    return (
                      <div
                        key={theme.id}
                        className={`flex items-center gap-4 rounded-xl border-2 p-4 transition-all ${
                          status === "completed"
                            ? "border-secondary/30 bg-secondary/5"
                            : status === "in_progress"
                            ? "border-primary/30 bg-primary/5"
                            : "border-border bg-background"
                        }`}
                      >
                        <span className="text-2xl shrink-0">{theme.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground">{theme.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {status === "completed"
                              ? `✅ Klart (${completedCount} svar)`
                              : status === "in_progress"
                              ? `⏳ Pågående (${completedCount}/${theme.questions.length} frågor)`
                              : `${theme.questions.length} frågor`}
                          </p>
                        </div>
                        {status !== "completed" && (
                          <Button
                            variant={status === "in_progress" ? "default" : "outline"}
                            size="sm"
                            className="shrink-0 gap-1"
                            onClick={() => navigate(`/bok/${book.id}/intervju/${theme.id}`)}
                          >
                            <Mic className="h-3.5 w-3.5" />
                            {status === "in_progress" ? "Fortsätt" : "Börja"}
                          </Button>
                        )}
                        {status === "completed" && (
                          <span className="text-secondary text-sm font-medium">✓ Klart</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Warnings inside the card */}
              {(!isPremium && book.page_count >= limits.maxPages) && (
                <div className="mx-8 mb-6 flex items-start gap-3 rounded-lg bg-primary/5 border border-primary/20 p-4">
                  <AlertTriangle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">
                      Du har nått maxgränsen på {limits.maxPages} sidor.
                    </p>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-primary text-sm"
                      onClick={() => startCheckout(book.id)}
                      disabled={checkoutLoading}
                    >
                      {checkoutLoading ? "Laddar..." : "Uppgradera till Premium →"}
                    </Button>
                  </div>
                </div>
              )}

              {inactivityUrgency && daysUntilDeletion !== null && !isPremium && (
                <div className={`mx-8 mb-6 flex items-start gap-3 rounded-lg p-4 ${
                  inactivityUrgency === "critical"
                    ? "bg-destructive/10 border border-destructive/20"
                    : inactivityUrgency === "urgent"
                    ? "bg-destructive/10 border border-destructive/20"
                    : "bg-primary/5 border border-primary/20"
                }`}>
                  <Clock className={`h-5 w-5 shrink-0 mt-0.5 ${
                    inactivityUrgency === "critical" || inactivityUrgency === "urgent"
                      ? "text-destructive"
                      : "text-primary"
                  }`} />
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${
                      inactivityUrgency === "critical" || inactivityUrgency === "urgent"
                        ? "text-destructive"
                        : "text-foreground"
                    }`}>
                      {daysUntilDeletion <= 5
                        ? `⚠️ SISTA VARNINGEN: Din bok raderas om ${daysUntilDeletion} dagar!`
                        : daysUntilDeletion <= 15
                        ? `Din bok raderas om ${daysUntilDeletion} dagar – logga in regelbundet för att behålla den`
                        : daysUntilDeletion <= 30
                        ? `VIKTIG INFO: Din bok raderas om ${daysUntilDeletion} dagar`
                        : `Din bok raderas om ${daysUntilDeletion} dagar vid inaktivitet`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Att redigera eller logga in nollställer räknaren. Du kan också uppgradera till Premium.
                    </p>
                    <Button
                      variant="link"
                      className={`p-0 h-auto text-sm mt-1 ${
                        inactivityUrgency === "critical" || inactivityUrgency === "urgent"
                          ? "text-destructive"
                          : "text-primary"
                      }`}
                      onClick={() => startCheckout(book.id)}
                      disabled={checkoutLoading}
                    >
                      {checkoutLoading ? "Laddar..." : "Uppgradera för att behålla den permanent →"}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Upgrade CTA for freemium */}
            {!isPremium && (
              <div className="rounded-2xl bg-secondary/10 border-2 border-secondary/30 p-6 mb-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-semibold text-foreground flex items-center gap-2">
                      <Crown className="h-5 w-5 text-primary" />
                      Uppgradera till Premium
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Upp till 300 sidor, obegränsade bilder, PDF utan vattenstämpel, tryckt bok
                    </p>
                  </div>
                  <Button
                    onClick={() => startCheckout(book.id)}
                    disabled={checkoutLoading}
                    className="gap-2 shrink-0"
                  >
                    <CreditCard className="h-4 w-4" />
                    {checkoutLoading ? "Laddar..." : "Köp Premium — 799 kr"}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Empty state */
          <div className="rounded-2xl bg-card p-12 shadow-sm text-center mb-8">
            <BookOpen className="mx-auto h-20 w-20 text-muted-foreground/30 mb-6" />
            <h3 className="font-serif text-2xl font-semibold text-card-foreground mb-3">Skapa din första bok</h3>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Börja dokumentera dina minnen genom att skapa en ny bok
            </p>
            <Button size="lg" className="gap-2" onClick={createNewBook}>
              <Plus className="h-5 w-5" />
              Skapa ny bok
            </Button>
          </div>
        )}

        {/* Plan info */}
        {book && (
          <div className="rounded-2xl bg-accent/30 border border-accent p-6">
            <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              {isPremium ? "Ditt Premium-paket" : "Gratisversion"}
            </h4>
            {isPremium ? (
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✓ Upp till 300 sidor per bok</li>
                <li>✓ Obegränsat med bilder</li>
                <li>✓ Obegränsad inspelning</li>
                <li>✓ 5 professionella mallar</li>
                <li>✓ Högupplöst PDF utan vattenstämpel</li>
                <li>✓ QR-koder för ljuduppspelning</li>
                <li>✓ Beställ tryckt bok</li>
              </ul>
            ) : (
              <>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>✓ 1 aktiv bok åt gången</li>
                  <li>✓ Max {FREEMIUM_LIMITS.maxPages} sidor per bok</li>
                  <li>✓ Max {FREEMIUM_LIMITS.maxImages} bilder totalt</li>
                  <li>✓ Röstinspelning och transkribering</li>
                  <li>✓ PDF-export med vattenstämpel</li>
                  <li>✓ Automatisk radering efter {INACTIVITY_DELETION_DAYS} dagars inaktivitet</li>
                </ul>
                <Button
                  variant="link"
                  className="mt-3 p-0 h-auto text-primary"
                  onClick={() => startCheckout(book.id)}
                  disabled={checkoutLoading}
                >
                  {checkoutLoading ? "Laddar..." : "Uppgradera till Premium — 799 kr →"}
                </Button>
              </>
            )}
          </div>
        )}
        {/* Help link */}
        <div className="mt-6 text-center">
          <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={() => navigate("/hjalp")}>
            <HelpCircle className="h-4 w-4" />
            Behöver du hjälp?
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Dashboard;
