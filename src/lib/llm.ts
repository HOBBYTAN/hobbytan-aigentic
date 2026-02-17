const API_PROXY_BASE = import.meta.env.VITE_API_PROXY_BASE || "";

export type LlmProvider = "openai" | "anthropic" | "xai" | "gemini";

export type LlmTextRequest = {
  provider: LlmProvider;
  model: string;
  input: string;
  instructions?: string;
  maxOutputTokens?: number;
  temperature?: number;
  baseUrl?: string;
  useWebSearch?: boolean;
  authToken?: string;
  // Backward compatibility only. Not used in proxy mode.
  apiKey?: string;
};

const resolveProxyUrl = (path: string) => {
  const base = API_PROXY_BASE.trim().replace(/\/+$/, "");
  if (!base) {
    return path;
  }
  return `${base}${path}`;
};

export const requestLlmText = async ({
  provider,
  model,
  input,
  instructions,
  maxOutputTokens,
  temperature,
  baseUrl,
  useWebSearch,
  authToken,
}: LlmTextRequest) => {
  const response = await fetch(resolveProxyUrl("/api/llm/text"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      provider,
      model,
      input,
      instructions,
      maxOutputTokens,
      temperature,
      baseUrl,
      useWebSearch,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Proxy LLM request failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as { text?: string };
  const text = payload.text?.trim();

  if (!text) {
    throw new Error("Proxy LLM response did not contain output text.");
  }

  return text;
};

export const tryParseJson = <T>(rawText: string): T | null => {
  const direct = rawText.trim();
  try {
    return JSON.parse(direct) as T;
  } catch {
    const start = direct.indexOf("{");
    const end = direct.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(direct.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
};
