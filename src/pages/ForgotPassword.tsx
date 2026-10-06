import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { Mail } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const ForgotPassword = () => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);
    if (error) {
      setError(error);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-lg">
          {sent ? (
            <div className="text-center">
              <div className="mb-4 text-5xl">📧</div>
              <h1 className="font-serif text-2xl font-bold text-card-foreground">Kolla din email</h1>
              <p className="mt-3 text-muted-foreground">
                Om ett konto finns med adressen <strong>{email}</strong> har vi skickat en återställningslänk.
              </p>
              <Link to="/logga-in">
                <Button variant="outline" className="mt-6">Tillbaka till inloggning</Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h1 className="font-serif text-3xl font-bold text-card-foreground">Glömt lösenord?</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ange din email så skickar vi en återställningslänk.
                </p>
              </div>

              {error && (
                <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="din@email.se"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="mt-1"
                  />
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  <Mail className="mr-2 h-4 w-4" />
                  {loading ? "Skickar..." : "Skicka återställningslänk"}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                <Link to="/logga-in" className="font-medium text-primary hover:underline">
                  Tillbaka till inloggning
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ForgotPassword;
