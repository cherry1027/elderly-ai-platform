import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface RealtimeMessage {
  role: "minna" | "user";
  content: string;
  type?: "question" | "acknowledgment" | "followup" | "closing";
  timestamp: string;
}

interface UseOpenAIRealtimeOptions {
  systemPrompt: string;
  onUserTranscript: (text: string) => void;
  onMinnaText: (text: string) => void;
  onMinnaAudioStart: () => void;
  onMinnaAudioEnd: () => void;
  onError: (error: string) => void;
}

export function useOpenAIRealtime({
  systemPrompt,
  onUserTranscript,
  onMinnaText,
  onMinnaAudioStart,
  onMinnaAudioEnd,
  onError,
}: UseOpenAIRealtimeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMinnaSpeaking, setIsMinnaSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentResponseTextRef = useRef("");

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setIsConnecting(true);

    try {
      // Get ephemeral token
      const { data, error } = await supabase.functions.invoke("openai-realtime-token", {
        body: {
          systemPrompt,
          voice: "shimmer",
        },
      });

      if (error) throw error;

      const ephemeralKey = data?.client_secret?.value;
      const sessionModel = data?.model || "gpt-realtime";
      if (!ephemeralKey) {
        console.error("Token response:", data);
        throw new Error("Kunde inte skapa session-token");
      }

      console.log("Session model:", sessionModel);

      // Connect to OpenAI Realtime GA via WebSocket (no openai-beta subprotocol)
      const ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${sessionModel}`,
        ["realtime", `openai-insecure-api-key.${ephemeralKey}`]
      );

      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected to OpenAI Realtime");
        setIsConnected(true);
        setIsConnecting(false);
        startMicrophone();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleServerEvent(msg);
        } catch (e) {
          console.error("WS message parse error:", e);
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket error:", e);
        onError("Anslutningsfel till röstservern");
      };

      ws.onclose = (e) => {
        console.log("WebSocket closed:", e.code, e.reason);
        setIsConnected(false);
        setIsConnecting(false);
        cleanup();
      };
    } catch (e) {
      console.error("Connect error:", e);
      setIsConnecting(false);
      onError(e instanceof Error ? e.message : "Kunde inte ansluta");
    }
  }, [systemPrompt]);

  const handleServerEvent = useCallback((msg: any) => {
    switch (msg.type) {
      case "response.audio.delta":
      case "response.output_audio.delta":
        // Received audio chunk from Minna
        if (msg.delta) {
          const audioData = base64ToInt16(msg.delta);
          playbackQueueRef.current.push(audioData);
          if (!isPlayingRef.current) {
            playAudioQueue();
          }
        }
        break;

      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        // Minna's text transcript (streaming)
        if (msg.delta) {
          currentResponseTextRef.current += msg.delta;
        }
        break;

      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        // Minna finished speaking this response item
        if (msg.transcript) {
          onMinnaText(msg.transcript);
          currentResponseTextRef.current = "";
        }
        break;

      case "response.created":
        setIsMinnaSpeaking(true);
        onMinnaAudioStart();
        break;

      case "response.done":
        setIsMinnaSpeaking(false);
        onMinnaAudioEnd();
        break;

      case "input_audio_buffer.speech_started":
        setIsUserSpeaking(true);
        break;

      case "input_audio_buffer.speech_stopped":
        setIsUserSpeaking(false);
        break;

      case "conversation.item.input_audio_transcription.completed":
        // User's speech transcribed
        if (msg.transcript?.trim()) {
          onUserTranscript(msg.transcript.trim());
        }
        break;

      case "error":
        console.error("Realtime API error:", msg.error);
        onError(msg.error?.message || "Realtime API-fel");
        break;
    }
  }, [onUserTranscript, onMinnaText, onMinnaAudioStart, onMinnaAudioEnd, onError]);

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 24000,
        },
      });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Use ScriptProcessorNode to capture PCM audio
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 PCM
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Send as base64
        const base64 = int16ToBase64(int16Data);
        wsRef.current.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64,
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (e) {
      console.error("Microphone error:", e);
      onError("Kunde inte starta mikrofonen. Kontrollera åtkomst.");
    }
  }, [onError]);

  const playAudioQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 });
    if (!audioContextRef.current) audioContextRef.current = audioContext;

    while (playbackQueueRef.current.length > 0) {
      const chunk = playbackQueueRef.current.shift()!;
      const float32 = new Float32Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        float32[i] = chunk[i] / 0x7fff;
      }

      const buffer = audioContext.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const bufferSource = audioContext.createBufferSource();
      bufferSource.buffer = buffer;
      bufferSource.connect(audioContext.destination);

      await new Promise<void>((resolve) => {
        bufferSource.onended = () => resolve();
        bufferSource.start();
      });
    }

    isPlayingRef.current = false;
  }, []);

  const sendTextMessage = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }));

    wsRef.current.send(JSON.stringify({
      type: "response.create",
    }));
  }, []);

  const cleanup = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();
    processorRef.current = null;
    sourceRef.current = null;
    mediaStreamRef.current = null;
    audioContextRef.current = null;
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanup();
    setIsConnected(false);
    setIsMinnaSpeaking(false);
    setIsUserSpeaking(false);
  }, [cleanup]);

  return {
    connect,
    disconnect,
    sendTextMessage,
    isConnected,
    isConnecting,
    isMinnaSpeaking,
    isUserSpeaking,
  };
}

// Utility: Int16Array → base64
function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Utility: base64 → Int16Array
function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}
