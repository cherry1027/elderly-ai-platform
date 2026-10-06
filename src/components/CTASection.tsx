import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const CTASection = () => {
  const navigate = useNavigate();

  return (
    <section className="bg-secondary py-20 md:py-24">
      <div className="container mx-auto px-4 text-center md:px-8">
        <h2 className="mx-auto max-w-2xl font-serif text-3xl font-bold text-secondary-foreground md:text-4xl">
          Börja bevara dina minnen idag
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-secondary-foreground/80">
          Det tar bara 5 minuter att komma igång. Dina berättelser förtjänar att
          leva vidare.
        </p>

        {/* Social proof */}
        <div className="flex flex-wrap items-center justify-center gap-6 mt-8 mb-8">
          <div className="flex items-center gap-2 text-secondary-foreground/70">
            <span className="text-2xl">📖</span>
            <span className="text-sm font-medium">2 000+ böcker skapade</span>
          </div>
          <div className="flex items-center gap-2 text-secondary-foreground/70">
            <span className="text-2xl">⭐</span>
            <span className="text-sm font-medium">4.9 av 5 i betyg</span>
          </div>
          <div className="flex items-center gap-2 text-secondary-foreground/70">
            <span className="text-2xl">🎙️</span>
            <span className="text-sm font-medium">Klart på 5 minuter</span>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center gap-3">
          <Button variant="hero" size="lg" className="px-10 py-6 text-base" onClick={() => navigate("/test")}>
            Testa gratis — ingen registrering
          </Button>
          <button
            onClick={() => navigate("/registrera")}
            className="text-sm text-secondary-foreground/70 hover:text-secondary-foreground underline underline-offset-2 transition"
          >
            Eller skapa konto direkt →
          </button>
          <Button
            variant="hero-outline"
            size="lg"
            className="px-10 py-6 text-base mt-2"
            onClick={() => navigate("/presentkort")}
          >
            Ge som present
          </Button>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
