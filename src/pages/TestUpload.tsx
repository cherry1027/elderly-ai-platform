import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, X as XIcon } from "lucide-react";
import Header from "@/components/Header";

interface UploadedImage {
  url: string;
}

const TestUpload = () => {
  const navigate = useNavigate();
  const [images, setImages] = useState<UploadedImage[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (images.length >= 1) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages((prev) => {
          if (prev.length >= 1) return prev;
          return [...prev, { url: reader.result as string }];
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const saveAndContinue = () => {
    localStorage.setItem("testImages", JSON.stringify(images.map((i) => i.url)));
    navigate("/test-resultat");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      {/* Progress */}
      <div className="bg-card border-b border-border px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>Steg 2 av 3</span>
            <span>Lägg till foton</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div className="h-full rounded-full bg-secondary transition-all" style={{ width: "66%" }} />
          </div>
        </div>
      </div>

      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-serif text-3xl font-bold text-center text-foreground mb-2">Lägg till foton</h1>
          <p className="text-center text-muted-foreground mb-10">Ladda upp 1 bild som hör till ditt minne</p>

          {/* Upload area */}
          {images.length < 1 && (
            <label
              className="block w-full cursor-pointer rounded-2xl border-4 border-dashed border-border bg-card p-12 text-center transition hover:border-primary mb-8"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple={false}
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
              <ImagePlus className="mx-auto h-16 w-16 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">Klicka för att välja bilder</p>
              <p className="text-sm text-muted-foreground mt-1">eller dra och släpp här</p>
              <p className="text-sm text-muted-foreground mt-1">Max 1 bild</p>
            </label>
          )}

          {/* Preview grid */}
          {images.length > 0 && (
            <div className="grid grid-cols-1 max-w-xs mx-auto gap-4 mb-10">
              {images.map((img, i) => (
                <div key={i} className="relative group rounded-xl overflow-hidden shadow border border-border">
                  <img src={img.url} alt={`Uppladdad ${i + 1}`} className="w-full h-48 object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-2 right-2 bg-destructive text-destructive-foreground p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between">
            <button
              onClick={() => navigate("/test-spela-in")}
              className="px-8 py-3 border-2 border-border rounded-full hover:bg-muted transition text-muted-foreground"
            >
              ← Tillbaka
            </button>
            <button
              onClick={saveAndContinue}
              className="rounded-full bg-secondary px-10 py-3 font-semibold text-secondary-foreground shadow-lg hover:bg-secondary/90 hover:scale-[1.02] transition-all"
            >
              {images.length > 0 ? "Se resultat →" : "Hoppa över →"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TestUpload;
