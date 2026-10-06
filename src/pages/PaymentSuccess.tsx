import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2 } from "lucide-react";

const PaymentSuccess = () => {
  const [searchParams] = useSearchParams();
  const [verifying, setVerifying] = useState(true);
  const [paid, setPaid] = useState(false);
  const [bookId, setBookId] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const bId = searchParams.get("book_id");
    if (bId) setBookId(bId);

    if (sessionId) {
      supabase.functions
        .invoke("verify-payment", { body: { session_id: sessionId } })
        .then(({ data }) => {
          setPaid(data?.paid === true);
          if (data?.book_id) setBookId(data.book_id);
        })
        .catch(() => setPaid(false))
        .finally(() => setVerifying(false));
    } else {
      setVerifying(false);
    }
  }, [searchParams]);

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Verifierar betalning...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-md px-4">
        {paid ? (
          <>
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <h1 className="text-3xl font-serif font-bold text-foreground">Tack för ditt köp!</h1>
            <p className="text-muted-foreground">
              Din bok har uppgraderats till Premium. Du kan nu använda alla premiumfunktioner.
            </p>
            <div className="flex gap-3 justify-center">
              {bookId && (
                <Link to={`/bok/${bookId}`}>
                  <Button>Gå till boken</Button>
                </Link>
              )}
              <Link to="/dashboard">
                <Button variant="outline">Till dashboard</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-serif font-bold text-foreground">Betalning kunde inte verifieras</h1>
            <p className="text-muted-foreground">
              Kontakta oss om du har blivit debiterad.
            </p>
            <Link to="/dashboard">
              <Button>Till dashboard</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentSuccess;
