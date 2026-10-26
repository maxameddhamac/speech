import { createTextContent, readProviderError } from "@/lib/providers";

export const maxDuration = 120;

const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OpenAI is not configured. Add OPENAI_API_KEY to your .env.local file." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Upload a valid audio file using multipart form data." }, { status: 400 });
  }

  const audio = form.get("audio");
  const language = form.get("language");
  if (!(audio instanceof File)) {
    return Response.json({ error: "Choose an audio file to transcribe." }, { status: 400 });
  }
  if (audio.size === 0) {
    return Response.json({ error: "The selected audio file is empty." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio files must be 24 MB or smaller." }, { status: 413 });
  }
  if (!audio.type.startsWith("audio/") && audio.type !== "video/webm") {
    return Response.json({ error: "Unsupported file type. Upload an audio file." }, { status: 415 });
  }
  if (typeof language !== "string" || language.length > 20) {
    return Response.json({ error: "Choose a valid spoken language." }, { status: 400 });
  }

  const transcriptionForm = new FormData();
  transcriptionForm.set("file", audio, audio.name || "recording.webm");
  transcriptionForm.set("model", "whisper-1");
  transcriptionForm.set("response_format", "json");
  if (language !== "auto") transcriptionForm.set("language", language);

  try {
    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcriptionForm,
      signal: AbortSignal.timeout(110_000),
    });
    if (!transcriptionResponse.ok) {
      const message = await readProviderError(transcriptionResponse);
      return Response.json({ error: `OpenAI transcription failed: ${message}` }, { status: 502 });
    }

    const transcription = (await transcriptionResponse.json()) as { text?: unknown };
    if (typeof transcription.text !== "string" || !transcription.text.trim()) {
      return Response.json({ error: "No speech was detected in this recording." }, { status: 422 });
    }

    const content = await createTextContent(transcription.text, language);
    return Response.json({ transcript: transcription.text, ...content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected provider error";
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json(
      { error: timedOut ? "The transcription request timed out. Try a shorter recording." : message },
      { status: timedOut ? 504 : 502 },
    );
  }
}
