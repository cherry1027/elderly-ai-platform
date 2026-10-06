import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Save, Mic, Square, ImagePlus, Trash2, X, GripVertical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface PageEditorProps {
  pageId: string;
  bookId: string;
  totalImages: number;
  maxImages: number;
  onUpdate: () => void;
}

interface ImageData {
  id: string;
  url: string;
  caption: string | null;
  position: number;
}

const PageEditor = ({ pageId, bookId, totalImages, maxImages, onUpdate }: PageEditorProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [audioStoragePath, setAudioStoragePath] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [images, setImages] = useState<ImageData[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Caption editing
  const [editingCaption, setEditingCaption] = useState<string | null>(null);
  const [captionText, setCaptionText] = useState("");

  useEffect(() => {
    loadPage();
  }, [pageId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function loadPage() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("pages")
        .select("*, images(*)")
        .eq("id", pageId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setTitle(data.title || "");
        setContent(data.content || "");
        setAudioDuration(data.audio_duration);
        setPageNumber(data.page_number);
        const imgs = ((data as any).images || []) as ImageData[];
        setImages(imgs.sort((a, b) => (a.position || 0) - (b.position || 0)));

        if (data.audio_url) {
          setAudioStoragePath(data.audio_url);
          const { data: signedData } = await supabase.storage
            .from("book-audio")
            .createSignedUrl(data.audio_url, 3600);
          setAudioURL(signedData?.signedUrl || null);
        } else {
          setAudioStoragePath(null);
          setAudioURL(null);
        }
      }
    } catch (error) {
      console.error("Error loading page:", error);
    } finally {
      setLoading(false);
    }
  }

  // ========== TEXT ==========

  async function saveText() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("pages")
        .update({ title, content, updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (error) throw error;
      toast({ title: "Sparat!", description: "Sidan har uppdaterats." });
      onUpdate();
    } catch (error) {
      console.error("Error saving:", error);
      toast({ title: "Fel", description: "Kunde inte spara.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ========== VOICE RECORDING ==========

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        await uploadAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      toast({ title: "Fel", description: "Kunde inte starta inspelning. Ge tillgång till mikrofonen.", variant: "destructive" });
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  async function uploadAudio(audioBlob: Blob) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");
      const fileName = `${user.id}/${bookId}/${pageId}/${Date.now()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from("book-audio")
        .upload(fileName, audioBlob, { contentType: "audio/webm", upsert: true });
      if (uploadError) throw uploadError;

      const storagePath = fileName;
      const { error: updateError } = await supabase
        .from("pages")
        .update({ audio_url: storagePath, audio_duration: recordingTime, updated_at: new Date().toISOString() })
        .eq("id", pageId);
      if (updateError) throw updateError;

      const { data: signedData } = await supabase.storage
        .from("book-audio")
        .createSignedUrl(storagePath, 3600);
      setAudioURL(signedData?.signedUrl || null);
      setAudioDuration(recordingTime);
      toast({ title: "Inspelning sparad!" });
      onUpdate();
    } catch (error) {
      console.error("Error uploading audio:", error);
      toast({ title: "Fel", description: "Kunde inte ladda upp ljudfilen.", variant: "destructive" });
    }
  }

  async function deleteAudio() {
    if (!confirm("Vill du radera ljudinspelningen?")) return;
    try {
      if (audioStoragePath) {
        await supabase.storage.from("book-audio").remove([audioStoragePath]);
      }
      const { error } = await supabase
        .from("pages")
        .update({ audio_url: null, audio_duration: null })
        .eq("id", pageId);
      if (error) throw error;
      setAudioURL(null);
      setAudioStoragePath(null);
      setAudioDuration(null);
      setRecordingTime(0);
      onUpdate();
    } catch (error) {
      console.error("Error deleting audio:", error);
    }
  }

  // ========== IMAGES ==========

  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    if (totalImages + files.length > maxImages) {
      toast({
        title: "Bildgräns nådd",
        description: `Max ${maxImages} bilder. Du har redan ${totalImages}.`,
        variant: "destructive",
      });
      return;
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        toast({ title: "För stor fil", description: `${file.name} överstiger 5MB.`, variant: "destructive" });
        return;
      }
    }

    try {
      for (const file of files) {
        await uploadImage(file);
      }
      await loadPage();
      onUpdate();
    } catch (error) {
      console.error("Error uploading images:", error);
      toast({ title: "Fel", description: "Kunde inte ladda upp bilder.", variant: "destructive" });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadImage(file: File) {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error("Not authenticated");
    const fileName = `${user.id}/${bookId}/${pageId}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("book-images")
      .upload(fileName, file, { contentType: file.type });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from("book-images").getPublicUrl(fileName);

    const { error: dbError } = await supabase.from("images").insert([
      {
        page_id: pageId,
        book_id: bookId,
        url: urlData.publicUrl,
        position: images.length,
        file_size: file.size,
      },
    ]);
    if (dbError) throw dbError;
  }

  async function deleteImage(imageId: string, imageUrl: string) {
    if (!confirm("Vill du radera denna bild?")) return;
    try {
      const parts = imageUrl.split("/book-images/");
      if (parts[1]) {
        await supabase.storage.from("book-images").remove([decodeURIComponent(parts[1])]);
      }
      await supabase.from("images").delete().eq("id", imageId);
      await loadPage();
      onUpdate();
    } catch (error) {
      console.error("Error deleting image:", error);
    }
  }

  async function saveCaption(imageId: string) {
    try {
      await supabase.from("images").update({ caption: captionText }).eq("id", imageId);
      setImages(images.map(img => img.id === imageId ? { ...img, caption: captionText } : img));
      setEditingCaption(null);
      toast({ title: "Bildtext sparad!" });
    } catch (error) {
      console.error("Error saving caption:", error);
    }
  }

  async function moveImage(imageId: string, direction: "up" | "down") {
    const idx = images.findIndex(img => img.id === imageId);
    if (idx < 0) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= images.length) return;

    const reordered = [...images];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];

    setImages(reordered);

    // Persist positions
    try {
      for (let i = 0; i < reordered.length; i++) {
        await supabase.from("images").update({ position: i }).eq("id", reordered[i].id);
      }
    } catch (error) {
      console.error("Error reordering:", error);
    }
  }

  function formatTime(seconds: number) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  if (loading) {
    return (
      <div className="bg-card rounded-lg shadow p-8 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg shadow">
      {/* Title bar */}
      <div className="border-b border-border p-4 flex items-center justify-between">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sidans titel..."
          className="font-serif text-xl border-none shadow-none focus-visible:ring-0 p-0 h-auto"
        />
        <Button variant="cta" size="sm" onClick={saveText} disabled={saving}>
          <Save className="w-4 h-4" />
          {saving ? "Sparar..." : "Spara"}
        </Button>
      </div>

      <div className="p-6 space-y-8">
        {/* VOICE RECORDING */}
        <section>
          <h3 className="text-lg font-semibold text-foreground mb-4">🎤 Röstinspelning</h3>

          {!audioURL ? (
            <div className="text-center py-8 border-2 border-dashed border-border rounded-lg">
              {!isRecording ? (
                <div>
                  <button
                    onClick={startRecording}
                    className="w-24 h-24 mx-auto bg-secondary text-secondary-foreground rounded-full flex items-center justify-center hover:opacity-90 transition shadow-lg"
                  >
                    <Mic className="w-10 h-10" />
                  </button>
                  <p className="mt-3 text-muted-foreground text-sm">Klicka för att börja spela in</p>
                </div>
              ) : (
                <div>
                  <button
                    onClick={stopRecording}
                    className="w-24 h-24 mx-auto bg-destructive text-destructive-foreground rounded-full flex items-center justify-center hover:opacity-90 transition animate-pulse shadow-lg"
                  >
                    <Square className="w-10 h-10" />
                  </button>
                  <p className="mt-3 text-2xl font-mono text-destructive">{formatTime(recordingTime)}</p>
                  <p className="text-muted-foreground text-sm">Klicka för att stoppa</p>
                </div>
              )}
            </div>
          ) : (
            <div className="border border-border rounded-lg p-4 bg-muted/30">
              <audio controls src={audioURL} className="w-full mb-3" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Längd: {formatTime(audioDuration || 0)}
                </span>
                <button onClick={deleteAudio} className="text-destructive hover:underline text-sm">
                  Radera inspelning
                </button>
              </div>
            </div>
          )}
        </section>

        {/* IMAGES */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-foreground">📷 Bilder</h3>
            <span className="text-sm text-muted-foreground">{totalImages} / {maxImages} använda</span>
          </div>

          {images.length > 0 && (
            <div className="space-y-3 mb-4">
              {images.map((img, idx) => (
                <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border bg-muted/20">
                  <div className="flex">
                    {/* Reorder handle */}
                    <div className="flex flex-col items-center justify-center px-2 bg-muted/40 gap-1">
                      <button
                        onClick={() => moveImage(img.id, "up")}
                        disabled={idx === 0}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
                        title="Flytta upp"
                      >
                        ▲
                      </button>
                      <GripVertical className="w-4 h-4 text-muted-foreground/50" />
                      <button
                        onClick={() => moveImage(img.id, "down")}
                        disabled={idx === images.length - 1}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-0.5"
                        title="Flytta ned"
                      >
                        ▼
                      </button>
                    </div>

                    {/* Image */}
                    <img src={img.url} alt={img.caption || ""} className="w-32 h-24 object-cover" />

                    {/* Caption + actions */}
                    <div className="flex-1 p-3 flex flex-col justify-between">
                      {editingCaption === img.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={captionText}
                            onChange={(e) => setCaptionText(e.target.value)}
                            placeholder="Skriv en bildtext..."
                            className="text-sm h-8"
                            autoFocus
                            onKeyDown={(e) => e.key === "Enter" && saveCaption(img.id)}
                          />
                          <Button size="sm" variant="outline" onClick={() => saveCaption(img.id)} className="h-8 text-xs">
                            Spara
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingCaption(img.id); setCaptionText(img.caption || ""); }}
                          className="text-sm text-left text-muted-foreground hover:text-foreground"
                        >
                          {img.caption || "Klicka för att lägga till bildtext..."}
                        </button>
                      )}
                      <div className="flex justify-end mt-1">
                        <button
                          onClick={() => deleteImage(img.id, img.url)}
                          className="text-destructive/60 hover:text-destructive text-xs flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> Radera
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {totalImages < maxImages ? (
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
              <ImagePlus className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground text-sm">Klicka för att ladda upp bilder</p>
              <p className="text-xs text-muted-foreground mt-1">
                Max {maxImages - totalImages} bild(er) kvar · Max 5MB per bild
              </p>
            </label>
          ) : (
            <div className="p-4 bg-accent border border-border rounded-lg text-sm text-muted-foreground">
              ⚠️ Max {maxImages} bilder nått.{" "}
              {maxImages <= 3 && <a href="/priser" className="text-primary hover:underline">Uppgradera till Premium</a>}
            </div>
          )}
        </section>

        {/* TEXT CONTENT */}
        <section>
          <h3 className="text-lg font-semibold text-foreground mb-4">✍️ Text</h3>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Skriv dina minnen här, eller använd röstinspelning..."
            rows={12}
            className="resize-none"
          />
        </section>
      </div>
    </div>
  );
};

export default PageEditor;
