import { useState } from "react";
import { Gift, QrCode, Heart, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const giftOptions = [
  { id: "premium", label: "Premium", price: 799, description: "Engångsköp — ev. tryckkostnad för bok tillkommer" },
];

const GiftCard = () => {
  const [selected, setSelected] = useState("premium");
  const [purchased, setPurchased] = useState(false);

  const selectedOption = giftOptions.find((o) => o.id === selected)!;

  const handlePurchase = () => {
    // TODO: Integrate with Stripe for real payments
    setPurchased(true);
  };

  if (purchased) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-16 text-center md:px-8">
          <div className="mx-auto max-w-lg">
            <div className="mb-8 inline-flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
              <Gift className="h-12 w-12 text-primary" />
            </div>
            <h1 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
              Ditt presentkort är klart!
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Skanna QR-koden nedan eller dela länken med den du vill ge presenten till.
            </p>

            {/* QR Code placeholder */}
            <div className="mx-auto mt-10 flex h-64 w-64 items-center justify-center rounded-2xl border-2 border-dashed border-primary/30 bg-card shadow-sm">
              <div className="text-center">
                <QrCode className="mx-auto h-32 w-32 text-primary" />
                <p className="mt-2 text-sm font-medium text-muted-foreground">
                  {selectedOption.label} — {selectedOption.price} kr
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-2xl bg-card p-6 shadow-sm">
              <p className="text-sm text-muted-foreground">Presentkortskod:</p>
              <p className="mt-1 font-mono text-xl font-bold tracking-wider text-foreground">
                MM-{Math.random().toString(36).substring(2, 8).toUpperCase()}
              </p>
            </div>

            <Button
              variant="outline"
              className="mt-6"
              onClick={() => setPurchased(false)}
            >
              Köp ett till presentkort
            </Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-16 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Heart className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-serif text-3xl font-bold text-foreground md:text-4xl">
            Ge den bästa gåvan
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Ge någon du älskar möjligheten att bevara sina livsminnen i en vacker bok.
            Mottagaren får en QR-kod som aktiverar deras konto.
          </p>
        </div>

        {/* Gift options */}
        <div className="mx-auto mt-12 grid max-w-3xl gap-4 sm:grid-cols-3">
          {giftOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelected(option.id)}
              className={`rounded-2xl border-2 p-6 text-left transition-all ${
                selected === option.id
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <BookOpen className={`h-6 w-6 ${selected === option.id ? "text-primary" : "text-muted-foreground"}`} />
              <h3 className="mt-3 font-serif text-lg font-semibold text-foreground">{option.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
              <p className="mt-4 text-2xl font-bold text-foreground">{option.price} kr</p>
            </button>
          ))}
        </div>

        {/* Purchase button */}
        <div className="mt-10 text-center">
          <Button size="lg" onClick={handlePurchase} className="px-12 py-6 text-lg">
            <Gift className="mr-2 h-5 w-5" />
            Köp presentkort — {selectedOption.price} kr
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">
            Du får en QR-kod att skriva ut eller skicka digitalt
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default GiftCard;
