import { useState } from "react";
import { Search, ChevronDown, ChevronRight, HelpCircle, Mic, Edit, Download, AlertTriangle, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useNavigate } from "react-router-dom";

interface FaqItem {
  q: string;
  a: string;
}

interface FaqCategory {
  icon: React.ReactNode;
  title: string;
  items: FaqItem[];
}

const FAQ_DATA: FaqCategory[] = [
  {
    icon: <Mic className="h-5 w-5" />,
    title: "Komma igång",
    items: [
      { q: "Hur spelar jag in mitt första kapitel?", a: "Gå till din bok och välj ett tema. Klicka på \"Börja\" så guidar Minna dig genom frågorna. Du svarar med din röst och texten skapas automatiskt." },
      { q: "Behöver jag en mikrofon?", a: "Ja, du behöver en fungerande mikrofon. De flesta laptops och mobiler har inbyggd mikrofon som fungerar bra. Se till att ge webbläsaren åtkomst till mikrofonen." },
      { q: "Hur lång tid tar det att göra en bok?", a: "Det beror på dig! Varje intervjusession tar ca 15-30 minuter. De flesta användare gör 2-3 sessioner per vecka och har en färdig bok inom några veckor." },
      { q: "Kan jag pausa och fortsätta senare?", a: "Absolut! Dina framsteg sparas automatiskt. Du kan logga ut och fortsätta exakt där du slutade nästa gång." },
    ],
  },
  {
    icon: <Edit className="h-5 w-5" />,
    title: "Redigering",
    items: [
      { q: "Hur lägger jag till bilder?", a: "I bokredigeraren klickar du på \"Lägg till bild\" i det kapitel du vill. Du kan ladda upp foton från din dator eller mobil. Bilderna kan ha bildtexter." },
      { q: "Kan jag ändra texten efter inspelning?", a: "Ja! All text som skapats från inspelning kan redigeras fritt. Klicka på texten i redigeraren för att göra ändringar." },
      { q: "Hur byter jag ordning på kapitel?", a: "I bokredigeraren kan du dra och släppa kapitel för att ändra ordningen. Du kan också ändra kapitelnummer manuellt." },
    ],
  },
  {
    icon: <Download className="h-5 w-5" />,
    title: "Export & delning",
    items: [
      { q: "Hur skapar jag en PDF?", a: "Gå till din bok och klicka \"Exportera\". Välj PDF-format och kvalitet. Premium-användare får PDF utan vattenstämpel." },
      { q: "Kan jag beställa en fysisk bok?", a: "Ja, Premium-användare kan beställa tryckta böcker! Gå till \"Beställ tryckt bok\" i din bokvy. Vi samarbetar med professionella tryckerier för hög kvalitet." },
      { q: "Hur delar jag min bok med familjen?", a: "Du kan dela en PDF-fil via e-post eller skapa en delningslänk. Premium-användare kan dela med fler personer och utan vattenstämpel." },
    ],
  },
  {
    icon: <AlertTriangle className="h-5 w-5" />,
    title: "Tekniska problem",
    items: [
      { q: "Ljudet fungerar inte – vad gör jag?", a: "1. Kontrollera att mikrofonen är inkopplad. 2. Klicka på hänglås-ikonen i webbläsarens URL-fält och tillåt mikrofon. 3. Ladda om sidan. 4. Prova en annan webbläsare (Chrome rekommenderas)." },
      { q: "Min text sparades inte – vad hände?", a: "Texten sparas automatiskt var 30:e sekund. Kontrollera din internetanslutning. Om problemet kvarstår, kontakta support." },
      { q: "Jag kan inte logga in", a: "Kontrollera att du använder rätt e-postadress. Prova \"Glömt lösenord\" för att återställa. Om du fortfarande inte kan logga in, kontakta support." },
      { q: "Vilka webbläsare stöds?", a: "Vi rekommenderar Google Chrome (senaste versionen). Safari, Firefox och Edge fungerar också. Äldre webbläsare kan ha begränsad funktionalitet." },
    ],
  },
];

const HelpCenter = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<number | null>(0);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const filteredData = search.trim().length < 2
    ? FAQ_DATA
    : FAQ_DATA.map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.q.toLowerCase().includes(search.toLowerCase()) ||
            item.a.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter((cat) => cat.items.length > 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-10 max-w-3xl">
        <Button variant="ghost" className="mb-6 gap-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Tillbaka
        </Button>

        <div className="text-center mb-10">
          <HelpCircle className="mx-auto h-12 w-12 text-primary mb-4" />
          <h1 className="font-serif text-3xl font-bold text-foreground mb-2">Hjälpcenter</h1>
          <p className="text-muted-foreground">Hitta svar på vanliga frågor om Minaminnen</p>
        </div>

        {/* Search */}
        <div className="relative mb-8">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök bland vanliga frågor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* FAQ Categories */}
        <div className="space-y-4">
          {filteredData.map((cat, catIdx) => (
            <div key={catIdx} className="rounded-xl bg-card shadow-sm overflow-hidden">
              <button
                className="w-full flex items-center gap-3 p-5 text-left hover:bg-accent/50 transition-colors"
                onClick={() => setExpandedCategory(expandedCategory === catIdx ? null : catIdx)}
              >
                <span className="text-primary">{cat.icon}</span>
                <span className="font-serif text-lg font-semibold text-foreground flex-1">{cat.title}</span>
                <span className="text-xs text-muted-foreground mr-2">{cat.items.length} frågor</span>
                {expandedCategory === catIdx ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </button>

              {expandedCategory === catIdx && (
                <div className="border-t border-border">
                  {cat.items.map((item, itemIdx) => {
                    const key = `${catIdx}-${itemIdx}`;
                    const isOpen = expandedItem === key;
                    return (
                      <div key={itemIdx} className="border-b border-border last:border-0">
                        <button
                          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-accent/30 transition-colors"
                          onClick={() => setExpandedItem(isOpen ? null : key)}
                        >
                          <span className="flex-1 text-sm font-medium text-foreground">{item.q}</span>
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-4">
                            <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {filteredData.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">Inga resultat hittades för "{search}"</p>
              <Button variant="outline" onClick={() => navigate("/kontakta-support")}>
                Kontakta support istället
              </Button>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="mt-10 rounded-xl bg-primary/5 border border-primary/20 p-6 text-center">
          <p className="text-foreground font-medium mb-2">Hittade du inte svaret?</p>
          <p className="text-sm text-muted-foreground mb-4">Vårt team hjälper dig gärna!</p>
          <Button onClick={() => navigate("/kontakta-support")} className="gap-2">
            💬 Kontakta support
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default HelpCenter;
