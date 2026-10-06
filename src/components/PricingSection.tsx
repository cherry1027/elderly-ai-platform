import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { useToast } from "@/hooks/use-toast";

const tiers = [
  {
    name: "Testa kostnadsfritt",
    price: "0 kr",
    description: "Testa och upplev tjänsten",
    features: [
      "15 minuters inspelning",
      "10 foton",
      "1 aktiv bok",
      "Grundläggande transkription",
      "1 standardmall",
      "PDF med vattenstämpel",
    ],
    cta: "Testa kostnadsfritt",
    popular: false,
    action: "free",
  },
  {
    name: "Premium",
    price: "799 kr",
    description: "Engångsköp – verktyget. Tryck per bok tillkommer (399–899 kr).",
    features: [
      "Obegränsad inspelning och lagring",
      "5 professionella mallar",
      "QR-koder för ljuduppspelning i tryckt bok",
      "Högupplöst PDF utan vattenstämpel",
      "Tryck bok i 24, 36, 48, 72 sidor – eller fritt antal",
      "Betala bara tryckkostnad per beställd bok",
    ],
    cta: "Välj Premium",
    popular: true,
    action: "premium",
  },
];

const PricingSection = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { startCheckout, loading } = useStripeCheckout();

  const handleClick = async (action: string) => {
    if (action === "free") {
      navigate("/test");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      toast({ title: "Logga in först", description: "Du behöver ett konto för att köpa Premium." });
      navigate("/logga-in");
      return;
    }

    await startCheckout();
  };

  return (
    <section id="priser" className="bg-card py-20 md:py-28">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <h2 className="font-serif text-3xl font-bold text-card-foreground md:text-4xl">
            Välj ditt paket
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Börja gratis och uppgradera när du är redo
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 max-w-3xl mx-auto">
          {tiers.map((tier, index) => (
            <div
              key={index}
              className={`relative rounded-2xl border p-8 transition-all duration-300 hover:-translate-y-1 ${
                tier.popular
                  ? "border-primary bg-primary/5 shadow-lg scale-[1.02]"
                  : "border-border bg-background shadow-sm hover:shadow-md"
              }`}
            >
              {tier.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground">
                  Mest populär
                </span>
              )}
              <h3 className="font-serif text-2xl font-bold text-foreground">{tier.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
              <p className="mt-4 font-serif text-3xl font-bold text-foreground">{tier.price}</p>

              <ul className="mt-8 space-y-3">
                {tier.features.map((feature, fi) => (
                  <li key={fi} className="flex items-start gap-3 text-sm text-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                variant={tier.popular ? "default" : "outline"}
                className="mt-8 w-full py-5"
                size="lg"
                disabled={loading && tier.action === "premium"}
                onClick={() => handleClick(tier.action)}
              >
                {loading && tier.action === "premium" ? "Laddar..." : tier.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
