import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

if (!API_KEY || API_KEY === "your_gemini_api_key_here") {
  console.error("❌  Missing GEMINI_API_KEY in .env — get a free key at https://aistudio.google.com");
  process.exit(1);
}

// Detect if the Anthropic-style tools array requests web search
function wantsWebSearch(tools) {
  return tools?.some((t) => t.type === "web_search_20250305" || t.name === "web_search");
}

// Convert Anthropic messages format → Gemini contents
function toGeminiContents(messages) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : m.content.map((c) => c.text || "").join("") }],
  }));
}

// Convert Gemini response → Anthropic response (so frontend needs no changes)
function toAnthropicFormat(geminiData) {
  const text =
    geminiData.candidates?.[0]?.content?.parts
      ?.filter((p) => p.text)
      .map((p) => p.text)
      .join("") || "";
  return { content: [{ type: "text", text }] };
}

async function callGemini(geminiBody, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
    const data = await response.json();
    if (response.ok) return { ok: true, status: response.status, data };
    const retryable = response.status === 503 || response.status === 429;
    if (retryable && attempt < retries) {
      const delay = 2000 * Math.pow(2, attempt);
      console.warn(`Gemini ${response.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    console.error("Gemini API error:", JSON.stringify(data));
    return { ok: false, status: response.status, data };
  }
}

app.post("/api/claude", async (req, res) => {
  try {
    const geminiBody = {
      contents: toGeminiContents(req.body.messages),
      generationConfig: { maxOutputTokens: req.body.max_tokens || 1024 },
    };

    if (wantsWebSearch(req.body.tools)) {
      geminiBody.tools = [{ google_search: {} }];
    }

    const { ok, status, data } = await callGemini(geminiBody);

    if (!ok) return res.status(status).json(data);
    res.json(toAnthropicFormat(data));
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅  Backend running at http://localhost:${PORT} (Gemini ${MODEL})`);
});
