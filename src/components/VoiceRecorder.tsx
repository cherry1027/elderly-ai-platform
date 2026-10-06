import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Play, Pause, RotateCcw } from "lucide-react";

interface VoiceRecorderProps {
  onRecordingComplete?: (blob: Blob) => void;
  maxDurationSeconds?: number;
}

const VoiceRecorder = ({ onRecordingComplete, maxDurationSeconds = 300 }: VoiceRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>(new Array(40).fill(4));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    const bars = 40;
    const step = Math.floor(data.length / bars);
    const newWaveform = Array.from({ length: bars }, (_, i) => {
      const val = data[i * step] / 255;
      return Math.max(4, val * 48);
    });
    setWaveform(newWaveform);
    animationRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Waveform analyser
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream);
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        onRecordingComplete?.(blob);
        stream.getTracks().forEach((t) => t.stop());
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        setWaveform(new Array(40).fill(4));
      };

      mediaRecorder.start(1000); // chunks every second for auto-save
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setIsPaused(false);
      setAudioBlob(null);
      setAudioUrl(null);
      setElapsed(0);

      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= maxDurationSeconds) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);

      updateWaveform();
    } catch {
      setError("Mikrofon-åtkomst nekad. Tillåt mikrofon i webbläsaren.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
      updateWaveform();
    }
  };

  const resetRecording = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setElapsed(0);
    setIsPlaying(false);
    if (audioRef.current) audioRef.current.pause();
  };

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="rounded-2xl bg-card p-6 shadow-sm">
      <h2 className="mb-4 font-serif text-xl font-semibold text-card-foreground">
        🎙️ Spela in minne
      </h2>

      {error && (
        <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {/* Waveform */}
      <div className="mb-4 flex h-16 items-end justify-center gap-[2px]">
        {waveform.map((h, i) => (
          <div
            key={i}
            className="w-1.5 rounded-full bg-primary transition-all duration-75"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>

      {/* Timer */}
      <div className="mb-4 text-center">
        <span className="font-mono text-2xl font-bold text-foreground">{formatTime(elapsed)}</span>
        <span className="ml-2 text-sm text-muted-foreground">/ {formatTime(maxDurationSeconds)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        {!isRecording && !audioBlob && (
          <Button onClick={startRecording} size="lg" className="h-16 w-16 rounded-full p-0">
            <Mic className="h-7 w-7" />
          </Button>
        )}

        {isRecording && (
          <>
            {isPaused ? (
              <Button onClick={resumeRecording} variant="outline" size="lg" className="h-14 w-14 rounded-full p-0">
                <Play className="h-6 w-6" />
              </Button>
            ) : (
              <Button onClick={pauseRecording} variant="outline" size="lg" className="h-14 w-14 rounded-full p-0">
                <Pause className="h-6 w-6" />
              </Button>
            )}
            <Button onClick={stopRecording} variant="destructive" size="lg" className="h-16 w-16 rounded-full p-0">
              <Square className="h-7 w-7" />
            </Button>
          </>
        )}

        {audioBlob && !isRecording && (
          <>
            <Button onClick={togglePlayback} variant="outline" size="lg" className="h-14 w-14 rounded-full p-0">
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
            </Button>
            <Button onClick={resetRecording} variant="ghost" size="lg" className="h-14 w-14 rounded-full p-0">
              <RotateCcw className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>

      {audioUrl && <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} />}

      {isRecording && (
        <p className="mt-4 text-center text-xs text-muted-foreground animate-pulse">
          ● Inspelning pågår...
        </p>
      )}
    </div>
  );
};

export default VoiceRecorder;
