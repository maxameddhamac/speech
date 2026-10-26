type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

export async function createTextContent(transcript: string, requestedLanguage: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter is not configured. Add OPENROUTER_API_KEY to your .env.local file.");

  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content:
        "You are an expert multilingual editor. Preserve the speaker's intent and factual claims. Detect the language from the transcript unless one is specified. Return only valid JSON with exactly these string fields: language (human-readable language name), summary (a concise 1-3 sentence summary), enhancedText (a polished, natural version of the full transcript). Keep the same language as the speaker. Do not invent details.",
    },
    {
      role: "user",
      content: `Requested language: ${requestedLanguage === "auto" ? "detect from the transcript" : requestedLanguage}\n\nTranscript:\n${transcript}`,
    },
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      "X-Title": "Vox Studio",
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const message = await readProviderError(response);
    throw new Error(`OpenRouter request failed: ${message}`);
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned an empty response.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenRouter returned invalid JSON. Please try again.");
  }
  if (!isTextContent(parsed)) throw new Error("OpenRouter returned an incomplete content response.");

  return parsed;
}

export async function readProviderError(response: Response) {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; detail?: string };
    return parsed.error?.message || parsed.detail || response.statusText || "Unknown provider error";
  } catch {
    return body.slice(0, 500) || response.statusText || "Unknown provider error";
  }
}

function isTextContent(value: unknown): value is { language: string; summary: string; enhancedText: string } {
  if (!value || typeof value !== "object") return false;
  const content = value as Record<string, unknown>;
  return (
    typeof content.language === "string" &&
    typeof content.summary === "string" &&
    typeof content.enhancedText === "string" &&
    content.language.length > 0 &&
    content.summary.length > 0 &&
    content.enhancedText.length > 0
  );
}
