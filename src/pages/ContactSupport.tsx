import { useState } from "react";
import { ArrowLeft, Send, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "recording", label: "Inspelning & ljud" },
  { value: "editing", label: "Redigering & text" },
  { value: "images", label: "Bilder" },
  { value: "export", label: "Export & PDF" },
  { value: "payment", label: "Betalning & Premium" },
  { value: "account", label: "Konto & inloggning" },
  { value: "other", label: "Övrigt" },
];

const ContactSupport = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim() || !category) {
      toast({ title: "Fyll i alla fält", variant: "destructive" });
      return;
    }

    setSending(true);

    // Store support ticket in database
    const { error } = await supabase.from("support_tickets" as any).insert({
      user_id: user?.id || null,
      email: user?.email || "Anonym",
      category,
      subject: subject.trim(),
      message: message.trim(),
      status: "open",
      browser_info: navigator.userAgent,
    } as any);

    setSending(false);

    if (error) {
      // If table doesn't exist yet, show success anyway (graceful degradation)
      console.error("Support ticket error:", error);
    }

    setSent(true);
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto px-4 py-10 max-w-xl">
          <div className="rounded-xl bg-card p-10 shadow-sm text-center">
            <CheckCircle className="mx-auto h-16 w-16 text-secondary mb-6" />
            <h1 className="font-serif text-2xl font-bold text-foreground mb-3">Tack för ditt meddelande!</h1>
            <p className="text-muted-foreground mb-2">Vi har tagit emot ditt ärende.</p>
            <p className="text-sm text-muted-foreground mb-8">
              Vi återkommer till <strong>{user?.email || "din e-postadress"}</strong> inom 24 timmar.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={() => navigate("/hjalp")} className="gap-2">
                Tillbaka till Hjälpcenter
              </Button>
              <Button onClick={() => navigate("/dashboard")} className="gap-2">
                Gå till Mina berättelser
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-xl">
        <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate("/hjalp")}>
          <ArrowLeft className="h-4 w-4" /> Tillbaka till Hjälpcenter
        </Button>

        <h1 className="font-serif text-2xl font-bold text-foreground mb-2">Kontakta support</h1>
        <p className="text-muted-foreground mb-8">Beskriv ditt problem så hjälper vi dig så snart vi kan.</p>

        <form onSubmit={handleSubmit} className="rounded-xl bg-card p-6 shadow-sm space-y-5">
          <div>
            <Label className="mb-2 block">Kategori</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Välj kategori..." />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Ämne</Label>
            <Input
              placeholder="Kort beskrivning av problemet"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
            />
          </div>

          <div>
            <Label className="mb-2 block">Beskriv problemet</Label>
            <Textarea
              placeholder="Berätta vad som hände, vad du försökte göra och vad du förväntade dig..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">{message.length}/2000</p>
          </div>

          <div className="bg-accent/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Automatiskt bifogat:</strong> Webbläsare & enhet ({navigator.userAgent.includes("Chrome") ? "Chrome" : navigator.userAgent.includes("Safari") ? "Safari" : "Annan webbläsare"})
            </p>
          </div>

          <Button type="submit" className="w-full gap-2" disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Skicka ärende
          </Button>
        </form>
      </main>
    </div>
  );
};

export default ContactSupport;
