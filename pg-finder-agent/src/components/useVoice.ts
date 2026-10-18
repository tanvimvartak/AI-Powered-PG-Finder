"use client";
/**
 * Web Speech API hook (SpeechRecognition, en-IN) with graceful fallback.
 * Interim results stream into the transcript so the user sees words appear,
 * and the final text stays editable in the textbox before sending.
 */
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings (the Web Speech API isn't in lib.dom for all TS versions)
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function useVoice(onText: (text: string) => void) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const baseRef = useRef("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection must run on the client
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const start = useCallback(
    (currentText: string) => {
      const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
      const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!Ctor) {
        setError("Voice input isn't supported in this browser. Please type instead.");
        return;
      }
      setError(null);
      const rec = new Ctor();
      rec.lang = "en-IN";
      rec.continuous = false;
      rec.interimResults = true;
      baseRef.current = currentText ? currentText.trim() + " " : "";
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        onText((baseRef.current + text).replace(/\s+/g, " ").trimStart());
      };
      rec.onerror = (e) => {
        const map: Record<string, string> = {
          "not-allowed": "Microphone permission denied. You can type your request instead.",
          "no-speech": "Didn't catch that. Tap the mic and try again.",
          network: "Voice service unreachable. Please type instead.",
        };
        setError(map[e.error] ?? `Voice error: ${e.error}`);
        setListening(false);
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    [onText],
  );

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop };
}
