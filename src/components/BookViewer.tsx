import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Mic } from "lucide-react";
import { type BookTemplate, templateStyles } from "@/components/BookTemplateSelector";

interface PageImage {
  id: string;
  url: string;
  caption: string | null;
}

interface ViewerPage {
  id: string;
  page_number: number;
  title: string | null;
  content: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  images: PageImage[];
}

interface BookViewerProps {
  pages: ViewerPage[];
  bookTitle: string;
  template?: BookTemplate;
  isPremium?: boolean;
}

const BookViewer = ({ pages, bookTitle, template = "classic", isPremium = false }: BookViewerProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentPage = pages[currentIndex];
  const styles = templateStyles[template];

  if (!pages || pages.length === 0) {
    return (
      <div className="bg-card rounded-lg shadow-lg p-12 text-center">
        <p className="text-muted-foreground text-lg">
          Din bok är tom. Lägg till sidor för att se förhandsvisningen.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Book format – A5-like proportions */}
      <div
        className={`${styles.bodyBg} rounded-lg shadow-2xl overflow-hidden border border-border`}
        style={{ aspectRatio: "148/210" }}
      >
        <div className="h-full flex flex-col">
          {/* Book header */}
          <div className={`${styles.headerBg} ${styles.headerText} px-8 py-4`}>
            <h2 className={`text-2xl ${styles.titleClass.includes("font-") ? styles.titleClass.split(" ").filter(c => c.startsWith("font-")).join(" ") : "font-serif"}`}>
              {bookTitle}
            </h2>
            <p className="text-sm opacity-80">
              Sida {currentIndex + 1} av {pages.length}
            </p>
          </div>

          {/* Page content */}
          <div className="flex-1 p-8 overflow-y-auto">
            {currentPage.title && (
              <h3 className={`text-xl mb-4 pb-2 border-b ${styles.accentBorder} ${styles.titleClass}`}>
                {currentPage.title}
              </h3>
            )}

            {/* Audio */}
            {currentPage.audio_url && (
              <div className={`mb-6 rounded-lg p-4 border ${styles.accentBorder} bg-muted/20`}>
                <div className="flex items-center gap-2 mb-2">
                  <Mic className="w-5 h-5 text-secondary" />
                  <span className="text-sm font-medium text-secondary">Röstinspelning</span>
                </div>
                <audio controls src={currentPage.audio_url} className="w-full" />
              </div>
            )}

            {/* Images */}
            {currentPage.images && currentPage.images.length > 0 && (
              <div className="mb-6 space-y-4">
                {currentPage.images.map((image) => (
                  <div key={image.id} className={`overflow-hidden ${styles.imageBorder}`}>
                    <img
                      src={image.url}
                      alt={image.caption || ""}
                      className="w-full h-auto max-h-[400px] object-cover"
                    />
                    {image.caption && (
                      <p className={`text-sm italic p-2 bg-muted/30 ${styles.pageNumberClass}`}>
                        {image.caption}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Text */}
            {currentPage.content && (
              <p className={`whitespace-pre-wrap ${styles.bodyTextClass}`}>
                {currentPage.content}
              </p>
            )}

            {/* Empty page */}
            {!currentPage.audio_url &&
              !currentPage.content &&
              (!currentPage.images || currentPage.images.length === 0) && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>Denna sida är tom</p>
                </div>
              )}
          </div>

          {/* Navigation */}
          <div className="border-t border-border p-4 bg-muted/30 flex justify-between items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentIndex((i) => i - 1)}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="w-4 h-4" />
              Föregående
            </Button>

            <span className={`text-sm ${styles.pageNumberClass}`}>
              {currentIndex + 1} / {pages.length}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentIndex((i) => i + 1)}
              disabled={currentIndex === pages.length - 1}
            >
              Nästa
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Freemium notice */}
      {!isPremium && (
        <div className="mt-4 bg-accent border border-border rounded-lg p-4 text-center">
          <p className="text-muted-foreground text-sm">
            🔒 PDF-export innehåller vattenstämpel i Freemium-versionen
          </p>
        </div>
      )}
    </div>
  );
};

export default BookViewer;
