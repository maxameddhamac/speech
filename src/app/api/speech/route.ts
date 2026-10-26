import { readProviderError } from "@/lib/providers";

export const maxDuration = 120;

type SpeechVersion = {
  audio?: string;
  mimeType?: string;
  error?: string;
};

async function generateOpenAISpeech(text: string): Promise<SpeechVersion> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "OpenAI is not configured. Add OPENAI_API_KEY to .env.local." };

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text, response_format: "mp3" }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!response.ok) return { error: `OpenAI TTS failed: ${await readProviderError(response)}` };

  return { audio: Buffer.from(await response.arrayBuffer()).toString("base64"), mimeType: "audio/mpeg" };
}

async function generateElevenLabsSpeech(text: string): Promise<SpeechVersion> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { error: "ElevenLabs is not configured. Add ELEVENLABS_API_KEY to .env.local." };

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(110_000),
    },
  );
  if (!response.ok) return { error: `ElevenLabs TTS failed: ${await readProviderError(response)}` };

  return { audio: Buffer.from(await response.arrayBuffer()).toString("base64"), mimeType: "audio/mpeg" };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid JSON body with text to speak." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("text" in body) || typeof body.text !== "string") {
    return Response.json({ error: "Text to speak is required." }, { status: 400 });
  }

  const text = body.text.trim();
  if (!text) return Response.json({ error: "Text to speak cannot be empty." }, { status: 400 });
  if (text.length > 4000) {
    return Response.json({ error: "Text must be 4,000 characters or fewer to generate both voices." }, { status: 413 });
  }

  const [openai, elevenlabs] = await Promise.all([
    generateOpenAISpeech(text).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Unexpected OpenAI TTS error",
    })),
    generateElevenLabsSpeech(text).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Unexpected ElevenLabs TTS error",
    })),
  ]);

  if (openai.error && elevenlabs.error) {
    return Response.json({ error: `Speech generation failed for both providers. ${openai.error} ${elevenlabs.error}` }, { status: 502 });
  }

  return Response.json({ openai, elevenlabs });
}
