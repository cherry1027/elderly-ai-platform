import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

const oauth = () => (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;

const OAuthConsent = () => {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Saknar authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/logga-in?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error: detailsError } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message);
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  const decide = async (approve: boolean) => {
    setBusy(true);
    const { data, error: decideError } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (decideError) {
      setBusy(false);
      setError(decideError.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Auktoriseringsservern returnerade ingen adress att gå vidare till.");
      return;
    }
    window.location.href = target;
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        {error ? (
          <>
            <h1 className="font-serif text-2xl mb-3">Något gick fel</h1>
            <p className="text-muted-foreground">{error}</p>
          </>
        ) : !details ? (
          <p className="text-muted-foreground text-center">Laddar…</p>
        ) : (
          <>
            <h1 className="font-serif text-2xl mb-3">
              Anslut {details.client?.name ?? "en app"} till ditt konto
            </h1>
            <p className="text-muted-foreground mb-6">
              {details.client?.name ?? "Appen"} får läsa dina böcker och berättelser i Mina Minnen
              och kan spara nya berättelser åt dig. Du kan när som helst koppla bort den.
            </p>
            <div className="flex gap-3">
              <Button size="lg" disabled={busy} onClick={() => decide(true)} className="flex-1">
                Godkänn
              </Button>
              <Button
                size="lg"
                variant="outline"
                disabled={busy}
                onClick={() => decide(false)}
                className="flex-1"
              >
                Neka
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
};

export default OAuthConsent;
