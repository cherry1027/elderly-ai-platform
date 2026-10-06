import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Lock, BookOpen, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PRINT_TIERS, calculatePrintPrice, getTierPageCount, type PrintTier } from "@/lib/printPricing";

const PrintOrderPage = () => {
  const { bookId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTier, setSelectedTier] = useState<PrintTier>("p36");
  const [customPages, setCustomPages] = useState(48);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (user && bookId) checkAccess();
  }, [bookId, user]);

  async function checkAccess() {
    try {
      const { data } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId!)
        .eq("user_id", user!.id)
        .maybeSingle();
      setBook(data);
      if (data?.print_tier) setSelectedTier(data.print_tier as PrintTier);
      if (data?.target_page_count) setCustomPages(data.target_page_count);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckout() {
    if (!bookId) return;
    setSubmitting(true);
    try {
      // Save selected tier on the book first
      await supabase
        .from("books")
        .update({
          print_tier: selectedTier,
          target_page_count: getTierPageCount(selectedTier, customPages),
        })
        .eq("id", bookId);

      const { data, error } = await supabase.functions.invoke("create-print-payment", {
        body: {
          bookId,
          tier: selectedTier,
          customPages: selectedTier === "custom" ? customPages : undefined,
          quantity,
        },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (e: any) {
      toast.error("Kunde inte starta betalning: " + (e.message || "okänt fel"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const isFreemium = !book || book.plan_type === "freemium";
  const unitPrice = calculatePrintPrice(selectedTier, customPages);
  const total = unitPrice * quantity;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-primary text-primary-foreground p-4 shadow-md">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <button
            onClick={() => navigate(`/bok/${bookId}`)}
            className="flex items-center gap-1 hover:underline text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Tillbaka
          </button>
          <h1 className="text-xl font-serif">Beställ tryckt bok</h1>
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full p-6 md:p-8">
        {isFreemium ? (
          <div className="bg-card rounded-lg shadow-lg p-12 text-center">
            <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
            <h2 className="text-2xl font-serif mb-4 text-foreground">
              Tryckt bok kräver Premium
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Uppgradera till Premium (engångsavgift 799 kr) för att kunna beställa boken
              tryckt. Tryckkostnaden tillkommer per bok beroende på sidantal.
            </p>
            <Button variant="cta" size="lg" onClick={() => navigate("/#priser")}>
              Se Premium och uppgradera
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-card rounded-lg shadow-lg p-6 md:p-8">
              <div className="flex items-center gap-3 mb-2">
                <BookOpen className="w-7 h-7 text-primary" />
                <h2 className="text-2xl font-serif text-foreground">
                  Välj storlek på din bok
                </h2>
              </div>
              <p className="text-muted-foreground mb-6">
                Premium ingår – du betalar bara tryck och frakt per bok.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                {PRINT_TIERS.map((tier) => {
                  const isSelected = selectedTier === tier.id;
                  const price =
                    tier.id === "custom"
                      ? `från ${tier.basePriceSek} kr`
                      : `${tier.basePriceSek} kr`;
                  return (
                    <button
                      key={tier.id}
                      onClick={() => setSelectedTier(tier.id)}
                      className={`text-left rounded-xl border-2 p-5 transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-md"
                          : "border-border bg-background hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-serif text-lg font-semibold text-foreground">
                          {tier.label}
                        </span>
                        {isSelected && (
                          <span className="bg-primary text-primary-foreground rounded-full p-1">
                            <Check className="w-4 h-4" />
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{tier.description}</p>
                      <p className="font-serif text-xl font-bold text-primary">{price}</p>
                    </button>
                  );
                })}
              </div>

              {selectedTier === "custom" && (
                <div className="mt-6 p-4 bg-muted/40 rounded-lg">
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Antal sidor (minst 24)
                  </label>
                  <Input
                    type="number"
                    min={24}
                    max={400}
                    value={customPages}
                    onChange={(e) => setCustomPages(Math.max(24, Number(e.target.value) || 24))}
                    className="max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    399 kr för första 24 sidor, sedan 12 kr per extra sida.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-card rounded-lg shadow-lg p-6 md:p-8">
              <h3 className="font-serif text-xl font-semibold text-foreground mb-4">
                Antal exemplar
              </h3>
              <div className="flex items-center gap-4 mb-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                >
                  −
                </Button>
                <span className="text-2xl font-semibold w-12 text-center">{quantity}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setQuantity(Math.min(20, quantity + 1))}
                >
                  +
                </Button>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>
                    Pris per bok ({getTierPageCount(selectedTier, customPages)} sidor)
                  </span>
                  <span>{unitPrice} kr</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Antal</span>
                  <span>× {quantity}</span>
                </div>
                <div className="flex justify-between font-serif text-2xl font-bold text-foreground pt-2 border-t border-border">
                  <span>Totalt</span>
                  <span>{total} kr</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Frakt inom Sverige tillkommer vid kassan.
                </p>
              </div>

              <Button
                size="lg"
                className="w-full mt-6"
                onClick={handleCheckout}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Skickar dig till kassan…
                  </>
                ) : (
                  `Beställ för ${total} kr`
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PrintOrderPage;
