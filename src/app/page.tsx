"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

type ProcessResult = {
  transcript: string;
  summary: string;
  enhancedText: string;
  language: string;
};

type SpeechVersion = {
  audio: string;
  mimeType: string;
  error?: string;
};

type SpeechResult = {
  openai?: SpeechVersion;
  elevenlabs?: SpeechVersion;
};

type Phase = "idle" | "processing" | "ready" | "speaking";

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [speech, setSpeech] = useState<SpeechResult | null>(null);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("auto");
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [favorite, setFavorite] = useState("");
  const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "enhanced">("enhanced");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      Object.values(audioUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [audioUrls]);

  function selectFile(selected: File | undefined) {
    if (!selected) return;
    if (!selected.type.startsWith("audio/") && selected.type !== "video/webm") {
      setError("Choose an audio file such as MP3, WAV, M4A, or WebM.");
      return;
    }
    if (selected.size > MAX_AUDIO_BYTES) {
      setError("This file is larger than 24 MB. Choose a smaller audio file.");
      return;
    }
    setError("");
    setFile(selected);
    setResult(null);
    setSpeech(null);
    setFavorite("");
    setPhase("idle");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  }

  async function toggleRecording() {
    setError("");
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Audio recording is not supported in this browser. Upload an audio file instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        selectFile(new File([blob], `voice-recording.${extension}`, { type: blob.type }));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access was denied or is unavailable. Upload an audio file instead.");
    }
  }

  async function processAudio() {
    if (!file) return;
    setPhase("processing");
    setError("");
    setSpeech(null);
    try {
      const body = new FormData();
      body.set("audio", file);
      body.set("language", language);
      const response = await fetch("/api/process", { method: "POST", body });
      const payload = (await response.json()) as ProcessResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not process this recording.");
      setResult(payload);
      setPhase("ready");
      setActiveTab("enhanced");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong while processing audio.");
      setPhase("idle");
    }
  }

  async function generateSpeech() {
    if (!result) return;
    setPhase("speaking");
    setError("");
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: result.enhancedText }),
      });
      const payload = (await response.json()) as SpeechResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not generate speech.");
      const urls: Record<string, string> = {};
      for (const [provider, version] of [
        ["openai", payload.openai],
        ["elevenlabs", payload.elevenlabs],
      ] as const) {
        if (!version?.audio) continue;
        const bytes = Uint8Array.from(atob(version.audio), (character) => character.charCodeAt(0));
        urls[provider] = URL.createObjectURL(new Blob([bytes], { type: version.mimeType }));
      }
      setAudioUrls((previous) => {
        Object.values(previous).forEach((url) => URL.revokeObjectURL(url));
        return urls;
      });
      setSpeech(payload);
      setPhase("ready");
      if (payload.openai?.error || payload.elevenlabs?.error) {
        setError("One voice provider could not generate audio. Any successful version is still available below.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong while generating speech.");
      setPhase("ready");
    }
  }

  const busy = phase === "processing" || phase === "speaking";

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Vox Studio home">
          <span className="brand-mark"><Waveform /></span>
          <span>vox<span className="brand-light">studio</span></span>
        </Link>
        <div className="topbar-right">
          <span className="secure-badge"><span className="secure-dot" /> PRIVATE WORKSPACE</span>
          <a className="top-link" href="#how-it-works">How it works <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <section className="intro">
        <div className="eyebrow"><span className="eyebrow-line" /> YOUR VOICE, REIMAGINED</div>
        <h1>Turn a thought into<br /><span className="title-accent">something worth hearing.</span></h1>
        <p className="intro-copy">One recording in. A polished piece of writing and two studio-quality voices out.</p>
        <div className="pipeline" aria-label="Audio workflow">
          <span className="pipeline-item"><span className="pipeline-icon">01</span> Record</span>
          <span className="pipeline-dash" />
          <span className="pipeline-item"><span className="pipeline-icon">02</span> Refine</span>
          <span className="pipeline-dash" />
          <span className="pipeline-item"><span className="pipeline-icon">03</span> Listen</span>
        </div>
      </section>

      <section className="workspace" aria-label="Voice content creator">
        <div className="workspace-heading">
          <div>
            <span className="section-index">01 / SOURCE</span>
            <h2>Start with your voice</h2>
          </div>
          <span className="format-note">MP3 · WAV · M4A · WEBM <span> / </span> UP TO 24 MB</span>
        </div>

        <div
          className={`drop-zone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={fileInputRef} className="visually-hidden" type="file" accept="audio/*,video/webm" onChange={onFileChange} />
          {file ? (
            <div className="selected-file">
              <div className="file-symbol"><Waveform /></div>
              <div className="selected-file-info">
                <strong>{file.name}</strong>
                <span>{formatSize(file.size)} <span className="file-divider">·</span> Ready to transcribe</span>
              </div>
              <button className="text-button" onClick={() => { setFile(null); setResult(null); setSpeech(null); setPhase("idle"); }}>Remove</button>
            </div>
          ) : (
            <>
              <div className="upload-symbol"><UploadIcon /></div>
              <p className="drop-title">Drop your audio here <span>or</span> <button className="inline-button" onClick={() => fileInputRef.current?.click()}>browse files</button></p>
              <p className="drop-subtitle">Your recording stays yours. Add a file or record right here.</p>
            </>
          )}
        </div>

        <div className="input-controls">
          <div className="language-control">
            <label htmlFor="language">SPOKEN LANGUAGE</label>
            <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="en">English</option>
              <option value="so">Somali</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="ar">Arabic</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="sw">Swahili</option>
              <option value="hi">Hindi</option>
              <option value="zh">Chinese</option>
            </select>
          </div>
          <div className="action-group">
            <button className={`record-button${recording ? " is-recording" : ""}`} onClick={toggleRecording} disabled={busy}>
              <span className="record-dot" />{recording ? "Stop recording" : "Record audio"}
            </button>
            <button className="primary-button" onClick={processAudio} disabled={!file || busy || recording}>
              {phase === "processing" ? <><span className="spinner" /> Working on it…</> : <>Transcribe & refine <span aria-hidden="true">→</span></>}
            </button>
          </div>
        </div>

        {error && <div className="error-message" role="alert"><span>!</span>{error}</div>}

        {result && (
          <section className="results-section" aria-live="polite">
            <div className="workspace-heading result-heading">
              <div>
                <span className="section-index">02 / YOUR WORDS</span>
                <h2>A little clearer. Still you.</h2>
              </div>
              <span className="language-chip"><span className="language-pulse" /> DETECTED · {result.language}</span>
            </div>
            <div className="text-card">
              <div className="tabs" role="tablist" aria-label="Processed text">
                <button className={activeTab === "enhanced" ? "active" : ""} onClick={() => setActiveTab("enhanced")} role="tab" aria-selected={activeTab === "enhanced"}>Enhanced</button>
                <button className={activeTab === "summary" ? "active" : ""} onClick={() => setActiveTab("summary")} role="tab" aria-selected={activeTab === "summary"}>Summary</button>
                <button className={activeTab === "transcript" ? "active" : ""} onClick={() => setActiveTab("transcript")} role="tab" aria-selected={activeTab === "transcript"}>Transcript</button>
              </div>
              <div className="text-card-content" role="tabpanel">
                {activeTab === "enhanced" && result.enhancedText}
                {activeTab === "summary" && result.summary}
                {activeTab === "transcript" && result.transcript}
              </div>
              <div className="text-card-footer"><span>{result.enhancedText.trim().split(/\s+/).length} words · {result.language}</span><button className="text-button" onClick={() => navigator.clipboard.writeText(activeTab === "enhanced" ? result.enhancedText : activeTab === "summary" ? result.summary : result.transcript)}>Copy text ↗</button></div>
            </div>

            <div className="voice-heading">
              <div>
                <span className="section-index">03 / THE SOUND</span>
                <h2>Hear it in a new voice</h2>
              </div>
              <button className="secondary-button" onClick={generateSpeech} disabled={phase === "speaking"}>
                {phase === "speaking" ? <><span className="spinner dark-spinner" /> Creating voices…</> : <>Generate both voices <span aria-hidden="true">→</span></>}
              </button>
            </div>

            {speech && (
              <>
                <div className="voice-grid">
                  <VoiceCard
                    label="OPENAI"
                    name="Alloy"
                    description="Natural, clear & conversational"
                    url={audioUrls.openai}
                    error={speech.openai?.error}
                    favorite={favorite === "openai"}
                    onSelect={() => setFavorite("openai")}
                  />
                  <VoiceCard
                    label="ELEVENLABS"
                    name="Rachel"
                    description="Expressive, warm & human"
                    url={audioUrls.elevenlabs}
                    error={speech.elevenlabs?.error}
                    favorite={favorite === "elevenlabs"}
                    onSelect={() => setFavorite("elevenlabs")}
                  />
                </div>
                <p className="vote-caption">{favorite ? `Your pick: ${favorite === "openai" ? "OpenAI · Alloy" : "ElevenLabs · Rachel"}` : "Listen to both. Which one sounds better to you?"}</p>
              </>
            )}
          </section>
        )}
      </section>

      <section className="how-section" id="how-it-works">
        <div className="how-heading"><span className="section-index">A BETTER WAY TO GET FROM VOICE TO DONE</span><h2>From first take to final cut.</h2></div>
        <div className="how-grid">
          <div className="how-card"><span className="how-number">01</span><h3>Say it your way</h3><p>Record in your browser or drop in an audio file. We’ll pick up the language you’re speaking.</p></div>
          <div className="how-card"><span className="how-number">02</span><h3>Keep what you meant</h3><p>Get an accurate transcript, a quick summary, and a polished version that keeps your original meaning.</p></div>
          <div className="how-card"><span className="how-number">03</span><h3>Find the right voice</h3><p>Compare two generated voices, choose your favorite, and download either version to keep.</p></div>
        </div>
      </section>

      <footer className="footer">
        <Link className="brand footer-brand" href="/"><span className="brand-mark"><Waveform /></span><span>vox<span className="brand-light">studio</span></span></Link>
        <span>Made for the things you have to say.</span>
        <span className="footer-privacy"><span className="secure-dot" /> API keys stay on the server</span>
      </footer>
    </main>
  );
}

function VoiceCard({
  label,
  name,
  description,
  url,
  error,
  favorite,
  onSelect,
}: {
  label: string;
  name: string;
  description: string;
  url?: string;
  error?: string;
  favorite: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={`voice-card${favorite ? " is-favorite" : ""}`}>
      <div className="voice-card-head">
        <span className="voice-provider">{label}</span>
        {favorite && <span className="favorite-badge">YOUR PICK</span>}
      </div>
      <h3>{name}</h3>
      <p>{description}</p>
      {url ? (
        <>
          <audio className="audio-player" controls src={url}>Your browser does not support audio playback.</audio>
          <div className="voice-card-actions">
            <button className={`vote-button${favorite ? " selected" : ""}`} onClick={onSelect}>{favorite ? "✓ Your pick" : "Sounds better"}</button>
            <a className="download-link" href={url} download={`${name.toLowerCase()}-voice.mp3`}>Download ↓</a>
          </div>
        </>
      ) : error ? <p className="voice-error">{error}</p> : <p className="voice-pending">No audio generated.</p>}
    </article>
  );
}

function Waveform() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 10v4m4-8v12m4-16v20m4-14v8m4-12v16m4-11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

function UploadIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
