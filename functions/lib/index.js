"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const admin = __importStar(require("firebase-admin"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
if (!admin.apps.length) {
    admin.initializeApp();
}
const OPENAI_API_KEY = (0, params_1.defineSecret)("OPENAI_API_KEY");
const ANTHROPIC_API_KEY = (0, params_1.defineSecret)("ANTHROPIC_API_KEY");
const XAI_API_KEY = (0, params_1.defineSecret)("XAI_API_KEY");
const GEMINI_API_KEY = (0, params_1.defineSecret)("GEMINI_API_KEY");
const OPENAI_BASE = "https://api.openai.com/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const XAI_BASE = "https://api.x.ai/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DISABLED_SECRET_VALUES = new Set(["disabled", "missing", "not-configured", "none"]);
const isConfiguredSecret = (value) => {
    if (!value) {
        return false;
    }
    return !DISABLED_SECRET_VALUES.has(value.trim().toLowerCase());
};
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json({ limit: "25mb" }));
const trimSlash = (value) => value.replace(/\/+$/, "");
const readOpenAIText = (payload) => {
    if (typeof payload.output_text === "string" && payload.output_text.trim()) {
        return payload.output_text.trim();
    }
    const chunks = [];
    for (const item of payload.output || []) {
        for (const content of item.content || []) {
            if ((content.type === "output_text" || content.type === "text") &&
                typeof content.text === "string") {
                chunks.push(content.text);
            }
        }
    }
    return chunks.join("\n").trim();
};
const readResponseText = async (response) => {
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
};
const getAuthToken = (request) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
        return "";
    }
    return header.slice(7);
};
const requireFirebaseAuth = async (request, response, next) => {
    try {
        const token = getAuthToken(request);
        if (!token) {
            response.status(401).json({ error: "Missing Firebase ID token" });
            return;
        }
        await admin.auth().verifyIdToken(token);
        next();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Invalid Firebase ID token";
        response.status(401).json({ error: message });
    }
};
const requestOpenAIText = async (body) => {
    const apiKey = OPENAI_API_KEY.value();
    if (!isConfiguredSecret(apiKey)) {
        throw new Error("OPENAI_API_KEY is not configured.");
    }
    const endpoint = `${trimSlash(body.baseUrl || OPENAI_BASE)}/responses`;
    const payload = {
        model: body.model || "gpt-5.2",
        input: body.input || "",
    };
    if (body.instructions) {
        payload.instructions = body.instructions;
    }
    if (typeof body.maxOutputTokens === "number") {
        payload.max_output_tokens = body.maxOutputTokens;
    }
    const callOpenAI = async (requestPayload) => fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestPayload),
    });
    if (body.useWebSearch) {
        payload.tools = [{ type: "web_search_preview" }];
    }
    let response = await callOpenAI(payload);
    let failurePayload = null;
    if (!response.ok) {
        failurePayload = await readResponseText(response);
        // Retry once without web search tool for models/accounts that don't support it.
        if (body.useWebSearch) {
            const fallbackPayload = { ...payload };
            delete fallbackPayload.tools;
            response = await callOpenAI(fallbackPayload);
            if (!response.ok) {
                const fallbackFailure = await readResponseText(response);
                throw new Error(`OpenAI request failed (${response.status}): ${JSON.stringify(fallbackFailure)}`);
            }
        }
        else {
            throw new Error(`OpenAI request failed (${response.status}): ${JSON.stringify(failurePayload)}`);
        }
    }
    const json = (await response.json());
    const text = readOpenAIText(json);
    if (!text) {
        throw new Error("OpenAI response did not contain text output.");
    }
    return text;
};
const requestAnthropicText = async (body) => {
    const apiKey = ANTHROPIC_API_KEY.value();
    if (!isConfiguredSecret(apiKey)) {
        throw new Error("ANTHROPIC_API_KEY is not configured.");
    }
    const base = trimSlash(body.baseUrl || ANTHROPIC_BASE);
    const endpoint = base.endsWith("/messages") ? base : `${base}/messages`;
    const payload = {
        model: body.model || "claude-3-7-sonnet-latest",
        max_tokens: body.maxOutputTokens || 1200,
        messages: [{ role: "user", content: body.input || "" }],
    };
    if (body.instructions?.trim()) {
        payload.system = body.instructions.trim();
    }
    if (typeof body.temperature === "number") {
        payload.temperature = body.temperature;
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Anthropic request failed (${response.status}): ${JSON.stringify(await readResponseText(response))}`);
    }
    const json = (await response.json());
    const text = (json.content || [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text || "")
        .join("\n")
        .trim();
    if (!text) {
        throw new Error("Anthropic response did not contain text output.");
    }
    return text;
};
const requestXAIText = async (body) => {
    const apiKey = XAI_API_KEY.value();
    if (!isConfiguredSecret(apiKey)) {
        throw new Error("XAI_API_KEY is not configured.");
    }
    const endpoint = `${trimSlash(body.baseUrl || XAI_BASE)}/chat/completions`;
    const messages = [];
    if (body.instructions?.trim()) {
        messages.push({ role: "system", content: body.instructions.trim() });
    }
    messages.push({ role: "user", content: body.input || "" });
    const payload = {
        model: body.model || "grok-4",
        messages,
    };
    if (typeof body.maxOutputTokens === "number") {
        payload.max_tokens = body.maxOutputTokens;
    }
    if (typeof body.temperature === "number") {
        payload.temperature = body.temperature;
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`xAI request failed (${response.status}): ${JSON.stringify(await readResponseText(response))}`);
    }
    const json = (await response.json());
    const content = json.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) {
        return content.trim();
    }
    if (Array.isArray(content)) {
        const text = content
            .map((item) => (typeof item.text === "string" ? item.text : ""))
            .join("\n")
            .trim();
        if (text) {
            return text;
        }
    }
    throw new Error("xAI response did not contain text output.");
};
const requestGeminiText = async (body) => {
    const apiKey = GEMINI_API_KEY.value();
    if (!isConfiguredSecret(apiKey)) {
        throw new Error("GEMINI_API_KEY is not configured.");
    }
    const endpoint = `${trimSlash(body.baseUrl || GEMINI_BASE)}/models/${body.model || "gemini-2.5-pro"}:generateContent`;
    const prompt = body.instructions?.trim()
        ? [`System instruction:\n${body.instructions.trim()}`, body.input || ""].join("\n\n")
        : body.input || "";
    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
    const generationConfig = {};
    if (typeof body.maxOutputTokens === "number") {
        generationConfig.maxOutputTokens = body.maxOutputTokens;
    }
    if (typeof body.temperature === "number") {
        generationConfig.temperature = body.temperature;
    }
    if (Object.keys(generationConfig).length > 0) {
        payload.generationConfig = generationConfig;
    }
    if (body.useWebSearch) {
        payload.tools = [{ google_search: {} }];
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Gemini text request failed (${response.status}): ${JSON.stringify(await readResponseText(response))}`);
    }
    const json = (await response.json());
    const text = (json.candidates?.[0]?.content?.parts || [])
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("\n")
        .trim();
    if (!text) {
        throw new Error("Gemini response did not contain text output.");
    }
    return text;
};
const requestGeminiImage = async (body) => {
    const apiKey = GEMINI_API_KEY.value();
    if (!isConfiguredSecret(apiKey)) {
        throw new Error("GEMINI_API_KEY is not configured.");
    }
    const endpoint = `${GEMINI_BASE}/models/${body.model || "gemini-3-pro-image-preview"}:generateContent`;
    const parts = [{ text: body.prompt || "" }];
    for (const reference of body.references || []) {
        parts.push({
            inline_data: {
                mime_type: reference.mimeType,
                data: reference.data,
            },
        });
    }
    const payload = {
        contents: [{ role: "user", parts }],
        generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
                aspectRatio: body.aspectRatio || "16:9",
                imageSize: body.imageSize || "2K",
            },
        },
    };
    if (body.useSearch) {
        payload.tools = [{ google_search: {} }];
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Gemini image request failed (${response.status}): ${JSON.stringify(await readResponseText(response))}`);
    }
    const json = (await response.json());
    const partsOut = json.candidates?.[0]?.content?.parts || [];
    let text = "";
    let imageBase64 = "";
    let mimeType = "image/png";
    for (const part of partsOut) {
        if (!text && typeof part.text === "string") {
            text = part.text;
        }
        const inline = part.inlineData || part.inline_data;
        if (inline?.data) {
            imageBase64 = inline.data;
            mimeType =
                ("mimeType" in inline && inline.mimeType) ||
                    ("mime_type" in inline && inline.mime_type) ||
                    "image/png";
            break;
        }
    }
    if (!imageBase64) {
        throw new Error("Gemini image response did not include image data.");
    }
    return {
        text,
        imageBase64,
        mimeType,
    };
};
const handleLlmText = async (request, response) => {
    try {
        const body = (request.body || {});
        const provider = body.provider || "openai";
        if (!body.input || !String(body.input).trim()) {
            response.status(400).json({ error: "input is required" });
            return;
        }
        let text = "";
        switch (provider) {
            case "openai":
                text = await requestOpenAIText(body);
                break;
            case "anthropic":
                text = await requestAnthropicText(body);
                break;
            case "xai":
                text = await requestXAIText(body);
                break;
            case "gemini":
                text = await requestGeminiText(body);
                break;
            default:
                response.status(400).json({ error: `Unsupported provider: ${String(provider)}` });
                return;
        }
        const result = { text };
        response.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        response.status(500).json({ error: message });
    }
};
const handleGeminiImage = async (request, response) => {
    try {
        const body = (request.body || {});
        if (!body.prompt || !String(body.prompt).trim()) {
            response.status(400).json({ error: "prompt is required" });
            return;
        }
        const result = await requestGeminiImage(body);
        response.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        response.status(500).json({ error: message });
    }
};
const healthHandler = (_request, response) => {
    response.json({
        ok: true,
        providers: {
            openai: isConfiguredSecret(OPENAI_API_KEY.value()),
            anthropic: isConfiguredSecret(ANTHROPIC_API_KEY.value()),
            xai: isConfiguredSecret(XAI_API_KEY.value()),
            gemini: isConfiguredSecret(GEMINI_API_KEY.value()),
        },
    });
};
app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.post("/llm/text", requireFirebaseAuth, handleLlmText);
app.post("/api/llm/text", requireFirebaseAuth, handleLlmText);
app.post("/gemini/image", requireFirebaseAuth, handleGeminiImage);
app.post("/api/gemini/image", requireFirebaseAuth, handleGeminiImage);
exports.api = (0, https_1.onRequest)({
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "1GiB",
    secrets: [OPENAI_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY, GEMINI_API_KEY],
}, app);
