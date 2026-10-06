import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Users, BarChart3, Cpu, LayoutDashboard, ArrowLeft, MessageSquare } from "lucide-react";
import { Link } from "react-router-dom";

interface AdminUser {
  user_id: string;
  display_name: string | null;
  email: string;
  created_at: string;
  birth_year: number | null;
  relationship: string | null;
  book_count: number;
  roles: string[];
  last_sign_in: string | null;
}

interface UsageStats {
  totalCalls: number;
  totalTokens: number;
  byFunction: Record<string, number>;
  byModel: Record<string, number>;
  byDay: Record<string, number>;
}

interface Overview {
  totalUsers: number;
  totalBooks: number;
  totalOrders: number;
  totalApiCalls: number;
}

const AdminPanel = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ display_name: "", birth_year: "", relationship: "" });
  const [minnaConfig, setMinnaConfig] = useState({
    followup_system_prompt: "",
    structure_system_prompt: "",
    structure_test_system_prompt: "",
  });
  const [savingMinna, setSavingMinna] = useState(false);

  const callAdmin = async (action: string, params = {}) => {
    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action, ...params },
    });
    if (error) throw error;
    return data;
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, usageData, overviewData] = await Promise.all([
        callAdmin("list_users"),
        callAdmin("usage_stats"),
        callAdmin("overview"),
      ]);
      setUsers(usersData.users || []);
      setUsage(usageData);
      setOverview(overviewData);

      // Load Minna config
      const { data: mc } = await supabase
        .from("minna_config")
        .select("*")
        .eq("id", "default")
        .single();
      if (mc) {
        setMinnaConfig({
          followup_system_prompt: (mc as any).followup_system_prompt || "",
          structure_system_prompt: (mc as any).structure_system_prompt || "",
          structure_test_system_prompt: (mc as any).structure_test_system_prompt || "",
        });
      }
    } catch (e) {
      toast({ title: "Fel", description: "Kunde inte ladda admindata.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const saveMinnaConfig = async () => {
    setSavingMinna(true);
    try {
      const { error } = await supabase
        .from("minna_config")
        .update({
          followup_system_prompt: minnaConfig.followup_system_prompt,
          structure_system_prompt: minnaConfig.structure_system_prompt,
          structure_test_system_prompt: minnaConfig.structure_test_system_prompt,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", "default");
      if (error) throw error;
      toast({ title: "Sparat", description: "Minnas inställningar uppdaterades." });
    } catch {
      toast({ title: "Fel", description: "Kunde inte spara.", variant: "destructive" });
    } finally {
      setSavingMinna(false);
    }
  };

  const startEdit = (user: AdminUser) => {
    setEditingUser(user.user_id);
    setEditForm({
      display_name: user.display_name || "",
      birth_year: user.birth_year?.toString() || "",
      relationship: user.relationship || "",
    });
  };

  const saveEdit = async (userId: string) => {
    try {
      await callAdmin("update_user", {
        target_user_id: userId,
        display_name: editForm.display_name || null,
        birth_year: editForm.birth_year ? parseInt(editForm.birth_year) : null,
        relationship: editForm.relationship || null,
      });
      toast({ title: "Sparad", description: "Användarprofilen uppdaterades." });
      setEditingUser(null);
      loadData();
    } catch {
      toast({ title: "Fel", description: "Kunde inte spara.", variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  const models = [
    { name: "gpt-4o-mini-tts", use: "Text-till-tal (Minna)", voice: "shimmer" },
    { name: "gpt-4o-mini-realtime-preview", use: "Realtidsintervju", voice: "shimmer" },
    { name: "gpt-4o-mini-transcription", use: "Transkribering (realtime)", voice: "—" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center gap-4 mb-8">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <h1 className="text-3xl font-bold text-foreground">Adminpanel</h1>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" /> Översikt
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Användare
            </TabsTrigger>
            <TabsTrigger value="minna" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Minna
            </TabsTrigger>
            <TabsTrigger value="usage" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Förbrukning
            </TabsTrigger>
            <TabsTrigger value="models" className="flex items-center gap-2">
              <Cpu className="h-4 w-4" /> Modeller
            </TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Användare</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold">{overview?.totalUsers ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Böcker</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold">{overview?.totalBooks ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Beställningar</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold">{overview?.totalOrders ?? 0}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">API-anrop</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold">{overview?.totalApiCalls ?? 0}</p></CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Users */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle>Alla användare ({users.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="pb-2 pr-4">Namn</th>
                        <th className="pb-2 pr-4">Email</th>
                        <th className="pb-2 pr-4">Registrerad</th>
                        <th className="pb-2 pr-4">Senast inloggad</th>
                        <th className="pb-2 pr-4">Böcker</th>
                        <th className="pb-2 pr-4">Roller</th>
                        <th className="pb-2">Åtgärder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.user_id} className="border-b">
                          {editingUser === u.user_id ? (
                            <>
                              <td className="py-2 pr-4">
                                <Input
                                  value={editForm.display_name}
                                  onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                                  className="h-8"
                                />
                              </td>
                              <td className="py-2 pr-4 text-muted-foreground">{u.email}</td>
                              <td className="py-2 pr-4">{new Date(u.created_at).toLocaleDateString("sv-SE")}</td>
                              <td className="py-2 pr-4">{u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString("sv-SE") : "—"}</td>
                              <td className="py-2 pr-4">{u.book_count}</td>
                              <td className="py-2 pr-4">{u.roles.join(", ") || "user"}</td>
                              <td className="py-2 flex gap-1">
                                <Button size="sm" onClick={() => saveEdit(u.user_id)}>Spara</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingUser(null)}>Avbryt</Button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 pr-4 font-medium">{u.display_name || "—"}</td>
                              <td className="py-2 pr-4 text-muted-foreground">{u.email}</td>
                              <td className="py-2 pr-4">{new Date(u.created_at).toLocaleDateString("sv-SE")}</td>
                              <td className="py-2 pr-4">{u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString("sv-SE") : "—"}</td>
                              <td className="py-2 pr-4">{u.book_count}</td>
                              <td className="py-2 pr-4">{u.roles.join(", ") || "user"}</td>
                              <td className="py-2">
                                <Button size="sm" variant="outline" onClick={() => startEdit(u)}>Redigera</Button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Usage */}
          <TabsContent value="usage">
            <div className="grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Anrop per funktion</CardTitle></CardHeader>
                  <CardContent>
                    {usage && Object.entries(usage.byFunction).length > 0 ? (
                      <div className="space-y-2">
                        {Object.entries(usage.byFunction).sort(([, a], [, b]) => b - a).map(([fn, count]) => (
                          <div key={fn} className="flex justify-between items-center">
                            <span className="text-sm font-mono">{fn}</span>
                            <span className="text-sm font-bold">{count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Ingen data ännu.</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-sm">Anrop per modell</CardTitle></CardHeader>
                  <CardContent>
                    {usage && Object.entries(usage.byModel).length > 0 ? (
                      <div className="space-y-2">
                        {Object.entries(usage.byModel).sort(([, a], [, b]) => b - a).map(([model, count]) => (
                          <div key={model} className="flex justify-between items-center">
                            <span className="text-sm font-mono">{model}</span>
                            <span className="text-sm font-bold">{count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Ingen data ännu.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-sm">Totalt</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex gap-8">
                    <div>
                      <p className="text-muted-foreground text-xs">Antal anrop</p>
                      <p className="text-2xl font-bold">{usage?.totalCalls ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Totala tokens</p>
                      <p className="text-2xl font-bold">{usage?.totalTokens ?? 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Models */}
          <TabsContent value="models">
            <Card>
              <CardHeader><CardTitle>AI-modeller i användning</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">Modell</th>
                      <th className="pb-2 pr-4">Användning</th>
                      <th className="pb-2">Röst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.name} className="border-b">
                        <td className="py-3 pr-4 font-mono text-sm">{m.name}</td>
                        <td className="py-3 pr-4">{m.use}</td>
                        <td className="py-3">{m.voice}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Minna Config */}
          <TabsContent value="minna">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Följdfråge-prompt (followup)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={minnaConfig.followup_system_prompt}
                    onChange={(e) => setMinnaConfig({ ...minnaConfig, followup_system_prompt: e.target.value })}
                    rows={12}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-2">Systemprompt som styr Minnas bekräftelser och följdfrågor under intervjun.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Strukturerings-prompt (intervju)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={minnaConfig.structure_system_prompt}
                    onChange={(e) => setMinnaConfig({ ...minnaConfig, structure_system_prompt: e.target.value })}
                    rows={10}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-2">Systemprompt för att strukturera guidade intervjusvar till kapitel.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Strukturerings-prompt (inspelning/test)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={minnaConfig.structure_test_system_prompt}
                    onChange={(e) => setMinnaConfig({ ...minnaConfig, structure_test_system_prompt: e.target.value })}
                    rows={14}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-2">Systemprompt för att strukturera fria inspelningar till bokkapitel. Denna används i test-flödet och för uppladdade inspelningar.</p>
                </CardContent>
              </Card>

              <Button onClick={saveMinnaConfig} disabled={savingMinna}>
                {savingMinna ? "Sparar..." : "Spara alla prompts"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminPanel;
