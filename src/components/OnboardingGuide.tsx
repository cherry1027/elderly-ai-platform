import { useState } from "react";
import { Mic, FileText, Image, Download, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface OnboardingGuideProps {
  userId: string;
  onComplete: () => void;
}

const STEPS = [
  {
    icon: <Mic className="h-10 w-10 text-primary" />,
    title: "1. Prata med Minna",
    desc: "Minna ställer frågor om ditt liv. Du svarar med din röst – enkelt och naturligt.",
  },
  {
    icon: <FileText className="h-10 w-10 text-primary" />,
    title: "2. Text skapas automatiskt",
    desc: "Dina svar blir till skriven text. Du kan redigera hur mycket du vill.",
  },
  {
    icon: <Image className="h-10 w-10 text-primary" />,
    title: "3. Lägg till bilder",
    desc: "Gör boken personlig med dina favoritfoton och bildtexter.",
  },
  {
    icon: <Download className="h-10 w-10 text-primary" />,
    title: "4. Exportera & dela",
    desc: "Skapa en PDF eller beställ en vacker tryckt bok att ge till familjen.",
  },
];

const OnboardingGuide = ({ userId, onComplete }: OnboardingGuideProps) => {
  const [step, setStep] = useState(0);

  const handleComplete = async () => {
    await supabase
      .from("profiles")
      .update({ onboarding_completed: true } as any)
      .eq("user_id", userId);
    onComplete();
  };

  const handleSkip = () => {
    handleComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-foreground/60 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-8 relative">
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {step === 0 ? (
          /* Welcome screen */
          <div className="text-center">
            <p className="text-4xl mb-4">👋</p>
            <h2 className="font-serif text-2xl font-bold text-foreground mb-3">
              Välkommen till Minaminnen!
            </h2>
            <p className="text-muted-foreground mb-8">
              Så här fungerar det – på fyra enkla steg:
            </p>
            <Button onClick={() => setStep(1)} className="gap-2">
              Visa mig <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" className="block mx-auto mt-3 text-sm" onClick={handleSkip}>
              Hoppa över, jag förstår
            </Button>
          </div>
        ) : (
          /* Step view */
          <div className="text-center">
            <div className="flex justify-center mb-6">
              {STEPS[step - 1].icon}
            </div>
            <h3 className="font-serif text-xl font-semibold text-foreground mb-2">
              {STEPS[step - 1].title}
            </h3>
            <p className="text-muted-foreground mb-8">
              {STEPS[step - 1].desc}
            </p>

            {/* Progress dots */}
            <div className="flex justify-center gap-2 mb-6">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 rounded-full transition-all ${
                    i + 1 === step ? "w-6 bg-primary" : i + 1 < step ? "w-2 bg-primary/50" : "w-2 bg-border"
                  }`}
                />
              ))}
            </div>

            {step < STEPS.length ? (
              <Button onClick={() => setStep(step + 1)} className="gap-2">
                Nästa <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleComplete} className="gap-2">
                Sätt igång! 🎉
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OnboardingGuide;
