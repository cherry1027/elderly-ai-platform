import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Mail, Newspaper, Save, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import Header from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UserSettings {
  email_notifications: boolean;
  deletion_reminders: boolean;
  newsletter: boolean;
  inspiration_frequency: string;
}

const ProfilePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [settings, setSettings] = useState<UserSettings>({
    email_notifications: true,
    deletion_reminders: true,
    newsletter: false,
    inspiration_frequency: "weekly",
  });
  const [profile, setProfile] = useState<{ display_name: string | null; birth_year: number | null }>({ display_name: null, birth_year: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("profiles").select("display_name, birth_year").eq("user_id", user.id).maybeSingle(),
    ]).then(([settingsRes, profileRes]) => {
      if (settingsRes.data) {
        setSettings({
          email_notifications: settingsRes.data.email_notifications,
          deletion_reminders: settingsRes.data.deletion_reminders,
          newsletter: settingsRes.data.newsletter,
          inspiration_frequency: (settingsRes.data as any).inspiration_frequency || "weekly",
        });
      }
      if (profileRes.data) setProfile(profileRes.data);
      setLoading(false);
    });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("user_settings")
      .update({
        email_notifications: settings.email_notifications,
        deletion_reminders: settings.deletion_reminders,
        newsletter: settings.newsletter,
        inspiration_frequency: settings.inspiration_frequency,
      } as any)
      .eq("user_id", user.id);

    setSaving(false);
    if (error) {
      toast({ title: "Kunde inte spara", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Sparat!", description: "Dina inställningar har uppdaterats." });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-2xl">
        <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" /> Tillbaka
        </Button>

        <h1 className="font-serif text-3xl font-bold text-foreground mb-2">Min profil</h1>
        <p className="text-muted-foreground mb-8">{user?.email}</p>

        {profile.display_name && (
          <div className="rounded-xl bg-card p-6 shadow-sm mb-6">
            <h2 className="font-serif text-lg font-semibold text-foreground mb-2">Personuppgifter</h2>
            <p className="text-sm text-muted-foreground">Namn: {profile.display_name}</p>
            {profile.birth_year && <p className="text-sm text-muted-foreground">Födelseår: {profile.birth_year}</p>}
          </div>
        )}

        <div className="rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-serif text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Påminnelser & notiser
          </h2>

          <div className="space-y-6">
            {/* Inspiration reminders */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="text-foreground font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Inspirationspåminnelser
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Tips och frågeförslag för att fortsätta berätta din historia
                </p>
              </div>
              <Switch
                checked={settings.email_notifications}
                onCheckedChange={(v) => setSettings({ ...settings, email_notifications: v })}
              />
            </div>

            {settings.email_notifications && (
              <div className="ml-8">
                <Label className="text-sm text-muted-foreground mb-2 block">Frekvens</Label>
                <Select
                  value={settings.inspiration_frequency}
                  onValueChange={(v) => setSettings({ ...settings, inspiration_frequency: v })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">1 gång/vecka</SelectItem>
                    <SelectItem value="biweekly">Varannan vecka</SelectItem>
                    <SelectItem value="monthly">1 gång/månad</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Deletion reminders */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="text-foreground font-medium">Inaktivitetsvarningar</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Påminnelser innan din bok raderas vid inaktivitet (rekommenderat)
                </p>
              </div>
              <Switch
                checked={settings.deletion_reminders}
                onCheckedChange={(v) => setSettings({ ...settings, deletion_reminders: v })}
              />
            </div>

            {/* Newsletter */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="text-foreground font-medium flex items-center gap-2">
                  <Newspaper className="h-4 w-4 text-muted-foreground" />
                  Nyhetsbrev
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Månatliga tips och nyheter om Minaminnen
                </p>
              </div>
              <Switch
                checked={settings.newsletter}
                onCheckedChange={(v) => setSettings({ ...settings, newsletter: v })}
              />
            </div>
          </div>

          <Button className="mt-8 gap-2" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Spara inställningar
          </Button>
        </div>
      </main>
    </div>
  );
};

export default ProfilePage;
