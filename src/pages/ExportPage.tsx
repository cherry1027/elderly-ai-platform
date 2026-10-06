import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileDown, BookOpen, Lock, CreditCard, Check } from "lucide-react";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import jsPDF from "jspdf";
import type { BookTemplate } from "@/components/BookTemplateSelector";

// PDF-specific template styles (RGB colors, jsPDF font names)
const pdfTemplateStyles: Record<BookTemplate, {
  titleFont: string;
  titleStyle: string;
  bodyFont: string;
  bodyStyle: string;
  coverBg: [number, number, number];
  coverText: [number, number, number];
  titleColor: [number, number, number];
  bodyColor: [number, number, number];
  accentColor: [number, number, number];
  pageBg: [number, number, number] | null; // null = white
  lineHeight: number;
  titleSize: number;
  bodySize: number;
}> = {
  classic: {
    titleFont: "times", titleStyle: "bold",
    bodyFont: "times", bodyStyle: "normal",
    coverBg: [93, 64, 55], coverText: [255, 248, 240],
    titleColor: [50, 30, 20], bodyColor: [40, 40, 40],
    accentColor: [93, 64, 55], pageBg: null,
    lineHeight: 6.5, titleSize: 18, bodySize: 11,
  },
  modern: {
    titleFont: "helvetica", titleStyle: "bold",
    bodyFont: "helvetica", bodyStyle: "normal",
    coverBg: [30, 30, 30], coverText: [255, 255, 255],
    titleColor: [20, 20, 20], bodyColor: [60, 60, 60],
    accentColor: [30, 30, 30], pageBg: null,
    lineHeight: 7, titleSize: 18, bodySize: 10,
  },
  vintage: {
    titleFont: "times", titleStyle: "bolditalic",
    bodyFont: "times", bodyStyle: "normal",
    coverBg: [120, 90, 60], coverText: [240, 230, 210],
    titleColor: [80, 55, 30], bodyColor: [70, 50, 35],
    accentColor: [120, 90, 60], pageBg: [245, 238, 225],
    lineHeight: 6.5, titleSize: 17, bodySize: 11,
  },
  nature: {
    titleFont: "times", titleStyle: "bold",
    bodyFont: "times", bodyStyle: "normal",
    coverBg: [76, 140, 100], coverText: [255, 255, 255],
    titleColor: [50, 110, 70], bodyColor: [35, 60, 40],
    accentColor: [76, 140, 100], pageBg: [242, 248, 244],
    lineHeight: 6.5, titleSize: 18, bodySize: 11,
  },
  elegant: {
    titleFont: "times", titleStyle: "bold",
    bodyFont: "times", bodyStyle: "normal",
    coverBg: [60, 50, 35], coverText: [220, 195, 140],
    titleColor: [50, 40, 25], bodyColor: [60, 50, 40],
    accentColor: [190, 160, 90], pageBg: [250, 248, 242],
    lineHeight: 6.5, titleSize: 18, bodySize: 11,
  },
};

const ExportPage = () => {
  const { bookId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [book, setBook] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { startCheckout, loading: checkoutLoading } = useStripeCheckout();

  const isPremium = book?.plan_type === "premium";

  useEffect(() => {
    if (user && bookId) loadBookData();
  }, [bookId, user]);

  async function loadBookData() {
    try {
      const { data: bookData } = await supabase
        .from("books")
        .select("*")
        .eq("id", bookId!)
        .eq("user_id", user!.id)
        .maybeSingle();

      const { data: pagesData } = await supabase
        .from("pages")
        .select("*, images(*)")
        .eq("book_id", bookId!)
        .order("page_number");

      setBook(bookData);
      setPages(pagesData || []);
    } catch (error) {
      console.error("Error loading book:", error);
    } finally {
      setLoading(false);
    }
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function generatePDF() {
    if (!book) return;
    setGenerating(true);

    try {
      const template = (book.book_template || "classic") as BookTemplate;
      const style = pdfTemplateStyles[template];
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;

      function fillPageBg() {
        if (style.pageBg) {
          pdf.setFillColor(...style.pageBg);
          pdf.rect(0, 0, pageWidth, pageHeight, "F");
        }
      }

      function addWatermark() {
        if (!isPremium) {
          pdf.setFontSize(9);
          pdf.setTextColor(200, 200, 200);
          pdf.text("Skapad med Mina Minnen – Gratisversion", pageWidth / 2, pageHeight - 5, { align: "center" });
        }
      }

      function drawAccentLine(y: number) {
        pdf.setDrawColor(...style.accentColor);
        pdf.setLineWidth(0.5);
        pdf.line(margin, y, pageWidth - margin, y);
      }

      // Cover page
      pdf.setFillColor(...style.coverBg);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.setFontSize(28);
      pdf.setFont(style.titleFont, style.titleStyle);
      pdf.setTextColor(...style.coverText);
      const titleLines = pdf.splitTextToSize(book.title || "Min bok", pageWidth - margin * 2);
      pdf.text(titleLines, pageWidth / 2, pageHeight / 2 - 10, { align: "center" });
      drawAccentLine(pageHeight / 2 + 5);
      pdf.setFontSize(11);
      pdf.setFont(style.bodyFont, style.bodyStyle);
      pdf.text("Skapad med Mina Minnen", pageWidth / 2, pageHeight / 2 + 15, { align: "center" });
      addWatermark();

      // Content pages
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        pdf.addPage();
        fillPageBg();
        let y = margin;

        // Chapter title
        pdf.setFontSize(style.titleSize);
        pdf.setFont(style.titleFont, style.titleStyle);
        pdf.setTextColor(...style.titleColor);
        pdf.text(page.title || `Sida ${i + 1}`, margin, y);
        y += 3;
        drawAccentLine(y);
        y += 8;

        // Images
        if (page.images?.length) {
          for (const image of page.images) {
            try {
              const response = await fetch(image.url);
              const blob = await response.blob();
              const base64 = await blobToBase64(blob);
              const imgWidth = pageWidth - margin * 2;
              const imgHeight = 80;
              pdf.addImage(base64, "JPEG", margin, y, imgWidth, imgHeight);
              y += imgHeight + 5;
              if (y > pageHeight - 30) break;
            } catch {
              // skip failed images
            }
          }
        }

        // Body text
        if (page.content) {
          pdf.setFontSize(style.bodySize);
          pdf.setFont(style.bodyFont, style.bodyStyle);
          pdf.setTextColor(...style.bodyColor);
          const lines = pdf.splitTextToSize(page.content, pageWidth - margin * 2);
          for (const line of lines) {
            if (y > pageHeight - 20) {
              pdf.addPage();
              fillPageBg();
              y = margin;
              addWatermark();
            }
            pdf.text(line, margin, y);
            y += style.lineHeight;
          }
        }

        // Audio note
        if (page.audio_url) {
          y += 5;
          pdf.setFontSize(9);
          pdf.setTextColor(...style.accentColor);
          pdf.text("Ljudinspelning finns (ej inkluderad i PDF)", margin, y);
        }

        // Page number
        pdf.setFontSize(9);
        pdf.setTextColor(160, 160, 160);
        pdf.text(`${i + 1}`, pageWidth / 2, pageHeight - 8, { align: "center" });

        addWatermark();
      }

      // Upsell page only for freemium
      if (!isPremium) {
        pdf.addPage();
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(0, 0, 0);
        pdf.text("Vill du ha mer?", pageWidth / 2, 60, { align: "center" });
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "normal");
        const lines = [
          "Uppgradera till Premium för att:",
          "",
          "✓ Ta bort vattenstämpel",
          "✓ Upp till 300 sidor",
          "✓ Obegränsat med bilder",
          "✓ Beställ tryckt bok",
          "✓ Ljud i digital version",
          "",
          "Besök: minaminnen.se",
        ];
        let ly = 80;
        lines.forEach((l) => { pdf.text(l, pageWidth / 2, ly, { align: "center" }); ly += 7; });
        addWatermark();
      }

      const safeName = (book.title || "bok").replace(/[^a-zåäö0-9]/gi, "_");
      pdf.save(`${safeName}.pdf`);

      await supabase.storage
        .from("generated-pdfs")
        .upload(`${user!.id}/${bookId}/${Date.now()}_${safeName}.pdf`, pdf.output("blob"), {
          contentType: "application/pdf",
          upsert: true,
        });
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-primary text-primary-foreground p-4 shadow-md">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <button onClick={() => navigate(`/bok/${bookId}`)} className="flex items-center gap-1 hover:underline text-sm">
            <ArrowLeft className="w-4 h-4" /> Tillbaka till redigering
          </button>
          <h1 className="text-xl font-serif">Exportera bok</h1>
        </div>
      </header>

      <div className="flex-1 max-w-4xl mx-auto w-full p-8">
        <div className="bg-card rounded-lg shadow-lg p-8">
          <h2 className="text-2xl font-serif mb-6 text-foreground">Ladda ner din bok</h2>

          <div className="space-y-6">
            {/* PDF Export */}
            <div className="border border-border rounded-lg p-6">
              <div className="flex items-start gap-4">
                <FileDown className="w-10 h-10 text-primary shrink-0 mt-1" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    PDF-fil {isPremium ? "(Premium)" : "(Gratisversion)"}
                  </h3>
                  <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> Alla sidor inkluderade</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> Alla bilder inkluderade</li>
                    {isPremium ? (
                      <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> Utan vattenstämpel</li>
                    ) : (
                      <li className="text-muted-foreground">⚠️ Innehåller vattenstämpel</li>
                    )}
                  </ul>
                  <Button onClick={generatePDF} disabled={generating}>
                    {generating ? "Skapar PDF..." : "Ladda ner PDF"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Print */}
            <div className={`border border-border rounded-lg p-6 ${!isPremium ? "bg-muted/30 opacity-60" : ""} relative`}>
              {!isPremium && (
                <span className="absolute top-4 right-4 px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full">
                  Premium
                </span>
              )}
              <div className="flex items-start gap-4">
                <BookOpen className="w-10 h-10 text-muted-foreground shrink-0 mt-1" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-2">Tryckt bok</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Beställ din bok i fysiskt format – softcover eller hardcover
                  </p>
                  {isPremium ? (
                    <Button onClick={() => navigate(`/bestall/${bookId}`)}>
                      Beställ tryckt bok
                    </Button>
                  ) : (
                    <Button disabled variant="outline">
                      <Lock className="w-4 h-4" /> Kräver Premium
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Upgrade CTA - only for freemium */}
            {!isPremium && (
              <div className="bg-secondary/10 border-2 border-secondary/30 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-foreground mb-3">Uppgradera till Premium</h3>
                <ul className="space-y-2 mb-4 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> PDF utan vattenstämpel</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> Beställ tryckt bok</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> Upp till 300 sidor</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> Obegränsat med bilder</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-secondary" /> 5 professionella mallar</li>
                </ul>
                <Button
                  onClick={() => startCheckout(bookId)}
                  disabled={checkoutLoading}
                  className="gap-2"
                >
                  <CreditCard className="h-4 w-4" />
                  {checkoutLoading ? "Laddar..." : "Köp Premium — 799 kr"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportPage;
