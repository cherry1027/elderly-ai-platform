import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import heroFamily from "@/assets/hero-family.jpg";

const HeroSection = () => {
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden bg-secondary py-16 md:py-24">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,_hsl(var(--forest-light)/0.3)_0%,_transparent_60%)]" />

      <div className="container relative z-10 mx-auto px-4 md:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="animate-fade-in-up space-y-8">
            <h1 className="font-serif text-4xl font-bold leading-tight text-secondary-foreground md:text-5xl lg:text-6xl">
              Dina minnen bevarade — <em className="not-italic text-cream">för alltid</em>
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-secondary-foreground/85 md:text-xl">
              Spela in dina berättelser och låt AI förvandla dem till en vacker
              bok — på bara några minuter.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row">
              <Button
                variant="hero"
                size="lg"
                className="cursor-pointer text-base px-8 py-6"
                onClick={() => navigate("/test")}
              >
                Testa gratis — 5 min
              </Button>
              <Button
                variant="hero-outline"
                size="lg"
                className="cursor-pointer text-base px-8 py-6"
                onClick={() => {
                  const el = document.getElementById("exempel");
                  el?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Se exempel
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex text-gold">
                {[...Array(5)].map((_, i) => (
                  <span key={i} className="text-lg">★</span>
                ))}
              </div>
              <p className="text-sm text-secondary-foreground/75">
                Betygsatt 4.9 av 5 • 2 000+ nöjda familjer
              </p>
            </div>
          </div>

          <div className="relative animate-fade-in hidden lg:block">
            <div className="relative overflow-hidden rounded-2xl shadow-2xl">
              <img
                src={heroFamily}
                alt="Svensk familj som delar minnen tillsammans"
                className="h-auto w-full object-cover"
                loading="eager"
                width="600"
                height="400"
              />
            </div>
            <div className="absolute -bottom-4 -left-4 animate-float rounded-xl bg-cream-light p-4 shadow-lg">
              <p className="font-serif text-sm font-semibold text-foreground">📖 1 247 berättelser</p>
              <p className="text-xs text-muted-foreground">bevarade denna vecka</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
