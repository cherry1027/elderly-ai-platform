import { useNavigate } from "react-router-dom";
import { Check, X, ChevronRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const TestLanding = () => {
  const navigate = useNavigate();

  const handleStart = () => {
    // Keep a default theme for backwards compatibility with downstream pages
    localStorage.setItem("testTheme", "open");
    localStorage.setItem("testPersonName", "du");
    navigate("/test-spela-in");
  };


  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {/* Hero */}
      <section className="bg-secondary px-6 py-16 text-center text-secondary-foreground">
        <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4 max-w-2xl mx-auto">
          Prova att skapa ditt första minne
        </h1>
        <p className="text-lg md:text-xl text-secondary-foreground/85 mb-2 max-w-xl mx-auto">
          Spela in en berättelse, lägg till ett foto – se hur din sida blir på 5 minuter
        </p>
        <p className="text-sm text-secondary-foreground/60">
          Ingen registrering krävs • Helt gratis
        </p>
      </section>

      {/* Welcome */}
      <section className="bg-card px-6 py-12">
        <div className="mx-auto max-w-lg text-center">
          <h2 className="font-serif text-2xl font-bold text-foreground mb-2">
            Välkommen! Jag heter Minna 💜
          </h2>
          <p className="text-muted-foreground">
            Under de nästa 5 minuterna ska vi tillsammans börja berätta din historia. Jag börjar med en öppen fråga – ta gärna tid att tänka innan du svarar.
          </p>
        </div>
      </section>


      {/* Start CTA */}
      <section className="bg-background px-6 py-12">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-muted-foreground mb-8">
            Minna börjar med en öppen fråga och låter sedan dig berätta fritt om något som hänt i ditt liv.
          </p>
          <button
            onClick={handleStart}
            className="w-full rounded-full bg-secondary px-16 py-5 text-xl font-semibold text-secondary-foreground shadow-xl transition-all duration-300 hover:bg-secondary/90 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
          >
            Börja samtalet
            <ChevronRight className="h-6 w-6" />
          </button>
        </div>
      </section>

      {/* What's included */}
      <section className="bg-card px-6 py-12">
        <div className="mx-auto max-w-lg">
          <h2 className="font-serif text-2xl font-bold text-center mb-8 text-foreground">
            Vad ingår i testet?
          </h2>
          <ul className="space-y-4 text-lg">
            <li className="flex items-center gap-3 text-foreground">
              <Check className="h-6 w-6 shrink-0 text-secondary" />
              5 minuters röstinspelning
            </li>
            <li className="flex items-center gap-3 text-foreground">
              <Check className="h-6 w-6 shrink-0 text-secondary" />
              1 bild
            </li>
            <li className="flex items-center gap-3 text-foreground">
              <Check className="h-6 w-6 shrink-0 text-secondary" />
              AI strukturerar din berättelse med rubriker
            </li>
            <li className="flex items-center gap-3 text-foreground">
              <Check className="h-6 w-6 shrink-0 text-secondary" />
              Se din färdiga sida i bokformat
            </li>
            <li className="flex items-center gap-3 text-muted-foreground">
              <X className="h-6 w-6 shrink-0 text-destructive/60" />
              Kan ej laddas ner (uppgradera för att spara)
            </li>
          </ul>
        </div>
      </section>
      <Footer />
    </div>
  );
};

export default TestLanding;
