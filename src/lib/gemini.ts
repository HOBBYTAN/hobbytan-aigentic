const API_PROXY_BASE = import.meta.env.VITE_API_PROXY_BASE || "";

type InlineData = {
  mimeType?: string;
  mime_type?: string;
  data?: string;
};

type GeminiPart = {
  text?: string;
  inlineData?: InlineData;
  inline_data?: InlineData;
};

type GeminiResponse = {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

export type GeminiReferenceImage = {
  mimeType: string;
  data: string;
};

export type GeminiGenerateImageRequest = {
  prompt: string;
  model?: string;
  references?: GeminiReferenceImage[];
  aspectRatio?: string;
  imageSize?: "1K" | "2K" | "4K";
  useSearch?: boolean;
  authToken?: string;
  // Backward compatibility only. Not used in proxy mode.
  apiKey?: string;
};

export type GeminiGenerateImageResult = {
  text: string;
  imageBase64: string;
  mimeType: string;
};

const resolveProxyUrl = (path: string) => {
  const base = API_PROXY_BASE.trim().replace(/\/+$/, "");
  if (!base) {
    return path;
  }
  return `${base}${path}`;
};

export const fileToBase64 = async (file: File) => {
  const dataBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(dataBuffer);
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const readInlineData = (part: GeminiPart) => part.inlineData || part.inline_data;

export const generateGeminiImage = async ({
  prompt,
  model = "gemini-3-pro-image-preview",
  references = [],
  aspectRatio = "16:9",
  imageSize = "2K",
  useSearch = false,
  authToken,
}: GeminiGenerateImageRequest): Promise<GeminiGenerateImageResult> => {
  const response = await fetch(resolveProxyUrl("/api/gemini/image"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      prompt,
      model,
      references,
      aspectRatio,
      imageSize,
      useSearch,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Proxy Gemini request failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as GeminiResponse;

  if (payload.imageBase64) {
    return {
      text: payload.text || "",
      imageBase64: payload.imageBase64,
      mimeType: payload.mimeType || "image/png",
    };
  }

  const partsOut = payload.candidates?.[0]?.content?.parts || [];

  let textOutput = "";
  let imageBase64 = "";
  let mimeType = "image/png";

  for (const part of partsOut) {
    if (!textOutput && typeof part.text === "string") {
      textOutput = part.text;
    }

    const inlineData = readInlineData(part);
    if (inlineData?.data) {
      imageBase64 = inlineData.data;
      mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
      break;
    }
  }

  if (!imageBase64) {
    throw new Error("Gemini response did not include an image.");
  }

  return {
    text: textOutput,
    imageBase64,
    mimeType,
  };
};
