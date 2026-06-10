import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WordRange = {
  start: number;
  end: number;
};

export interface SpeechVoiceOption {
  id: string;
  label: string;
  lang: string;
}

export interface LanguageOption {
  lang: string;
  label: string;
  voiceCount: number;
}

export interface SpeechProgress {
  currentWordIndex: number;
  totalWords: number;
  percentage: number;
}

export interface UseSpeechSynthesisResult {
  isPlaying: boolean;
  isPaused: boolean;
  isSpeaking: boolean;
  play: (nextText?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  rate: number;
  setRate: (nextRate: number) => void;
  pitch: number;
  setPitch: (nextPitch: number) => void;
  volume: number;
  setVolume: (nextVolume: number) => void;
  progress: SpeechProgress;
  isSupported: boolean;
  isReady: boolean;
  error: string | null;
  currentWordIndex: number;
  isLoading: boolean;
  availableVoices: SpeechSynthesisVoice[];
  selectedVoiceIndex: number;
  setSelectedVoice: (index: number) => void;
  playbackRate: number;
  setPlaybackRate: (nextRate: number) => void;
  voices: SpeechVoiceOption[];
  selectedVoiceId: string;
  setSelectedVoiceId: (id: string) => void;
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;
  languageOptions: LanguageOption[];
}

const SPEED_MIN = 0.5;
const SPEED_MAX = 2;

const clampRate = (nextRate: number): number => {
  if (Number.isNaN(nextRate)) {
    return 1;
  }
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, nextRate));
};

const hasSpeechSupport = (): boolean => {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
};

const getVoiceId = (voice: SpeechSynthesisVoice): string =>
  voice.voiceURI || `${voice.name}-${voice.lang}`;

const filterVoicesByGender = (
  browserVoices: SpeechSynthesisVoice[],
  gender?: "female" | "male",
): SpeechSynthesisVoice[] => {
  if (!gender) {
    return browserVoices;
  }

  const femalePattern =
    /female|woman|samantha|zira|victoria|karen|moira|tessa|fiona|veena|lekha|susan|linda|heather|serena|aria/i;
  const malePattern =
    /male|man|daniel|david|alex|fred|tom|rishi|mark|james|george|richard|guy|ryan|brian/i;

  const pattern = gender === "female" ? femalePattern : malePattern;
  const filtered = browserVoices.filter((voice) => pattern.test(voice.name));

  return filtered.length > 0 ? filtered : browserVoices;
};

const toVoiceOptions = (browserVoices: SpeechSynthesisVoice[]): SpeechVoiceOption[] =>
  browserVoices.map((voice) => ({
    id: getVoiceId(voice),
    label: voice.name,
    lang: voice.lang,
  }));

const getLanguageLabel = (lang: string): string => {
  try {
    const display = new Intl.DisplayNames([window.navigator.language || "en"], {
      type: "language",
    });
    return display.of(lang.split("-")[0]) ?? lang;
  } catch {
    return lang;
  }
};

const buildWordRanges = (inputText: string): WordRange[] => {
  if (!inputText.trim()) {
    return [];
  }

  const ranges: WordRange[] = [];
  const wordPattern = /\S+/g;

  for (const match of inputText.matchAll(wordPattern)) {
    const start = match.index ?? 0;
    ranges.push({
      start,
      end: start + match[0].length,
    });
  }

  return ranges;
};

const getWordIndexAtCharIndex = (
  charIndex: number,
  ranges: WordRange[],
): number => {
  if (ranges.length === 0) {
    return 0;
  }

  const matchIndex = ranges.findIndex(
    (range) => charIndex >= range.start && charIndex <= range.end,
  );

  if (matchIndex >= 0) {
    return matchIndex;
  }

  const fallbackIndex = ranges.findIndex((range) => charIndex < range.start);
  return fallbackIndex >= 0 ? Math.max(0, fallbackIndex - 1) : ranges.length - 1;
};

export const useSpeechSynthesis = (
  text: string = "",
  voiceGender?: "female" | "male",
): UseSpeechSynthesisResult => {
  const [isSupported, setIsSupported] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [rateState, setRateState] = useState(1);
  const [pitchState, setPitchState] = useState(1);
  const [volumeState, setVolumeState] = useState(1);

  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en-US");

  // For compatibility with older AudioNarration components:
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const sessionRef = useRef(0);
  const previousTextRef = useRef(text);
  const browserVoicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const voices = useMemo(
    () => toVoiceOptions(filterVoicesByGender(browserVoices, voiceGender)),
    [browserVoices, voiceGender],
  );

  const languageOptions = useMemo<LanguageOption[]>(() => {
    const counts = new Map<string, number>();
    for (const voice of voices) {
      counts.set(voice.lang, (counts.get(voice.lang) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([lang, voiceCount]) => ({
        lang,
        label: getLanguageLabel(lang),
        voiceCount,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [voices]);

  const wordRanges = useMemo(() => buildWordRanges(text), [text]);
  const totalWords = wordRanges.length;

  const progress = useMemo<SpeechProgress>(() => {
    const hasNarrationProgress = isSpeaking || isPaused || currentWordIndex > 0;
    const spokenWords = hasNarrationProgress
      ? Math.min(currentWordIndex + 1, totalWords)
      : 0;

    return {
      currentWordIndex,
      totalWords,
      percentage: totalWords > 0 ? spokenWords / totalWords : 0,
    };
  }, [currentWordIndex, isPaused, isSpeaking, totalWords]);

  const resolveBrowserVoice = useCallback(
    (voiceId: string): SpeechSynthesisVoice | undefined => {
      const genderFiltered = filterVoicesByGender(browserVoicesRef.current, voiceGender);
      return genderFiltered.find((voice) => getVoiceId(voice) === voiceId);
    },
    [voiceGender],
  );

  const resetNarrationState = useCallback(() => {
    setIsPaused(false);
    setIsSpeaking(false);
    setCurrentWordIndex(0);
  }, []);

  const clearUtterance = useCallback(() => {
    utteranceRef.current = null;
    if (hasSpeechSupport()) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    clearUtterance();
    resetNarrationState();
  }, [clearUtterance, resetNarrationState]);

  const play = useCallback((nextText?: string) => {
    if (!isSupported) {
      setError("Speech synthesis is not supported in this browser.");
      return;
    }

    const textToSpeak = (nextText ?? text).trim();
    if (!textToSpeak) {
      setError("No story text is available for narration.");
      return;
    }

    if (!isReady) {
      setError("Speech voices are still loading. Please try again in a moment.");
      return;
    }

    const speechSynthesis = window.speechSynthesis;
    sessionRef.current += 1;
    const sessionId = sessionRef.current;

    clearUtterance();
    setError(null);
    setCurrentWordIndex(0);
    setIsPaused(false);
    setIsSpeaking(true);

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = rateState;
    utterance.pitch = pitchState;
    utterance.volume = volumeState;
    utterance.lang = selectedLanguage;

    // Use selectedVoiceId first if set, otherwise fallback to selectedVoiceIndex
    let browserVoice = resolveBrowserVoice(selectedVoiceId);
    if (!browserVoice && browserVoices.length > 0) {
      const fallbackVoice = browserVoices[selectedVoiceIndex];
      if (fallbackVoice) {
        browserVoice = fallbackVoice;
      }
    }

    if (browserVoice) {
      utterance.voice = browserVoice;
      utterance.lang = browserVoice.lang;
    }

    utterance.onstart = () => {
      if (sessionRef.current !== sessionId) return;
      setIsPaused(false);
      setIsSpeaking(true);
    };

    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      if (sessionRef.current !== sessionId) return;
      if (typeof event.charIndex === "number") {
        setCurrentWordIndex(getWordIndexAtCharIndex(event.charIndex, buildWordRanges(textToSpeak)));
      }
    };

    utterance.onend = () => {
      if (sessionRef.current !== sessionId) return;
      utteranceRef.current = null;
      setIsPaused(false);
      setIsSpeaking(false);
      setCurrentWordIndex(totalWords);
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (sessionRef.current !== sessionId) return;
      utteranceRef.current = null;
      setIsPaused(false);
      setIsSpeaking(false);
      if (event.error !== "interrupted") {
        setError("Narration failed to play.");
      }
    };

    utteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
  }, [
    clearUtterance,
    isReady,
    isSupported,
    pitchState,
    rateState,
    resolveBrowserVoice,
    selectedLanguage,
    selectedVoiceId,
    selectedVoiceIndex,
    browserVoices,
    text,
    totalWords,
    volumeState,
  ]);

  const pause = useCallback(() => {
    if (!isSupported || !utteranceRef.current) {
      return;
    }
    const speechSynthesis = window.speechSynthesis;
    if (!speechSynthesis.speaking || speechSynthesis.paused) {
      return;
    }
    speechSynthesis.pause();
    setIsPaused(true);
  }, [isSupported]);

  const resume = useCallback(() => {
    if (!isSupported || !utteranceRef.current) {
      return;
    }
    const speechSynthesis = window.speechSynthesis;
    if (!speechSynthesis.paused) {
      return;
    }
    speechSynthesis.resume();
    setIsPaused(false);
  }, [isSupported]);

  const setRate = useCallback((nextRate: number) => {
    const clamped = clampRate(nextRate);
    setRateState(clamped);
    if (utteranceRef.current) {
      utteranceRef.current.rate = clamped;
    }
  }, []);

  const setPitch = useCallback((nextPitch: number) => {
    setPitchState(nextPitch);
    if (utteranceRef.current) {
      utteranceRef.current.pitch = nextPitch;
    }
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    setVolumeState(nextVolume);
    if (utteranceRef.current) {
      utteranceRef.current.volume = nextVolume;
    }
  }, []);

  const setSelectedVoice = useCallback((index: number) => {
    stop();
    setError(null);
    setSelectedVoiceIndex(index);
    if (browserVoices[index]) {
      const voice = browserVoices[index];
      setSelectedVoiceId(getVoiceId(voice));
      setSelectedLanguage(voice.lang);
    }
  }, [stop, browserVoices]);

  useEffect(() => {
    const supported = hasSpeechSupport();
    setIsSupported(supported);

    if (!supported) {
      setIsReady(false);
      setError("Speech synthesis is not supported in this browser.");
      return;
    }

    const speechSynthesis = window.speechSynthesis;
    let isMounted = true;

    const syncVoices = () => {
      if (!isMounted) return;
      const loadedVoices = speechSynthesis.getVoices();
      browserVoicesRef.current = loadedVoices;
      setBrowserVoices(loadedVoices);
      setIsReady(loadedVoices.length > 0);
    };

    syncVoices();

    if (speechSynthesis.getVoices().length === 0) {
      speechSynthesis.addEventListener("voiceschanged", syncVoices);
      return () => {
        isMounted = false;
        speechSynthesis.removeEventListener("voiceschanged", syncVoices);
      };
    }
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (voices.length === 0) return;
    const voiceStillExists = voices.some((voice) => voice.id === selectedVoiceId);
    if (!voiceStillExists) {
      setSelectedVoiceId(voices[0].id);
    }
  }, [selectedVoiceId, voices]);

  useEffect(() => {
    if (languageOptions.length === 0) return;
    const languageStillExists = languageOptions.some(
      (option) => option.lang === selectedLanguage,
    );
    if (!languageStillExists) {
      setSelectedLanguage(languageOptions[0].lang);
    }
  }, [languageOptions, selectedLanguage]);

  useEffect(() => {
    const textChanged = previousTextRef.current !== text;
    previousTextRef.current = text;
    if (textChanged) {
      stop();
      if (isSupported) {
        setError(null);
      }
    }
  }, [isSupported, stop, text]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isPlaying: isSpeaking && !isPaused,
    isPaused,
    isSpeaking,
    play,
    pause,
    resume,
    stop,
    rate: rateState,
    setRate,
    pitch: pitchState,
    setPitch,
    volume: volumeState,
    setVolume,
    progress,
    isSupported,
    isReady,
    error,
    currentWordIndex,
    isLoading: isSupported && !isReady,
    availableVoices: browserVoices,
    selectedVoiceIndex,
    setSelectedVoice,
    playbackRate: rateState,
    setPlaybackRate: setRate,
    voices,
    selectedVoiceId,
    setSelectedVoiceId,
    selectedLanguage,
    setSelectedLanguage,
    languageOptions,
  };
};

export default useSpeechSynthesis;
