import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const Register = () => {
  const { signUp, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Lösenordet måste vara minst 8 tecken.");
      return;
    }

    setLoading(true);

    // If an invite code was provided, redeem it (skips email verification & grants premium).
    if (inviteCode.trim()) {
      const { data, error: fnError } = await supabase.functions.invoke("redeem-invite-code", {
        body: { email, password, displayName, code: inviteCode.trim() },
      });
      if (fnError || (data && (data as any).error)) {
        setLoading(false);
        setError(((data as any)?.error) || fnError?.message || "Kunde inte lösa in koden.");
        return;
      }
      const { error: signInError } = await signIn(email, password);
      setLoading(false);
      if (signInError) {
        setError(signInError);
        return;
      }
      navigate("/dashboard");
      return;
    }

    const { error } = await signUp(email, password, displayName);
    setLoading(false);

    if (error) {
      setError(error);
    } else {
      setSuccess(true);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto flex items-center justify-center px-4 py-16">
          <div className="w-full max-w-md rounded-2xl bg-card p-8 text-center shadow-lg">
            <div className="mb-4 text-5xl">📧</div>
            <h1 className="font-serif text-2xl font-bold text-card-foreground">Kolla din email!</h1>
            <p className="mt-3 text-muted-foreground">
              Vi har skickat en bekräftelselänk till <strong>{email}</strong>. Klicka på länken för att aktivera ditt konto.
            </p>
            <Link to="/logga-in">
              <Button variant="outline" className="mt-6">Tillbaka till inloggning</Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-lg">
          <div className="mb-6 text-center">
            <h1 className="font-serif text-3xl font-bold text-card-foreground">Skapa konto</h1>
            <p className="mt-2 text-sm text-muted-foreground">Börja bevara dina minnen idag</p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="displayName">Namn</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="Ditt namn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1"
              />
            </div>

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

            <div>
              <Label htmlFor="password">Lösenord (minst 8 tecken)</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Dölj lösenord" : "Visa lösenord"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(v) => setRememberMe(v === true)}
              />
              <Label htmlFor="remember" className="text-sm font-normal">Kom ihåg mig</Label>
            </div>

            <div className="pt-1">
              {!showInvite ? (
                <button
                  type="button"
                  onClick={() => setShowInvite(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  Har du en inbjudningskod?
                </button>
              ) : (
                <div>
                  <Label htmlFor="inviteCode" className="text-sm">Inbjudningskod</Label>
                  <Input
                    id="inviteCode"
                    type="text"
                    placeholder="T.ex. MINNEN-DEMO-2026"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    className="mt-1"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              <UserPlus className="mr-2 h-4 w-4" />
              {loading ? "Skapar konto..." : "Skapa konto"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Har du redan ett konto?{" "}
            <Link to="/logga-in" className="font-medium text-primary hover:underline">
              Logga in
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Register;
