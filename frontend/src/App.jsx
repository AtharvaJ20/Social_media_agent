import { useState, useRef, useEffect, useCallback } from "react";

// ── API base (local backend proxy) ────────────────────────────────────────────
const API_BASE = "http://localhost:3001";

// ── Platform config ────────────────────────────────────────────────────────────
const PLATFORMS = {
  instagram: {
    id: "instagram", label: "Instagram", icon: "📸",
    color: "#E1306C", bg: "#FFF0F6", accent: "#833AB4",
    keywords: ["instagram", "insta", "ig", "reel", "story"],
    style: "Visual-first caption with a bold hook, 5–10 relevant hashtags, emoji storytelling, and a CTA. Written as if accompanying a stunning photo or reel. Weave in current trending topics or viral formats naturally.",
    charLimit: 2200,
  },
  linkedin: {
    id: "linkedin", label: "LinkedIn", icon: "💼",
    color: "#0A66C2", bg: "#EEF4FF", accent: "#004182",
    keywords: ["linkedin", "linked in", "professional", "career", "job", "network"],
    style: "Student thinking out loud about an AI/data engineering topic. NO source claims ('I read X'), NO experience claims ('I built X' or 'at work I noticed'). Structure: Hook (a surprising or counterintuitive thing about this topic, stated directly), The Concept (explain it clearly in your own words with a specific insight woven in), Why It Matters For Learners (why a student getting into AI should care). End with a genuine CTA question. Tone: curious and direct, like a student sharing thoughts — not a journalist or expert. 1 emoji per section. Always include #LearningInPublic.",
    charLimit: 3000,
  },
  twitter: {
    id: "twitter", label: "X / Twitter", icon: "𝕏",
    color: "#000000", bg: "#F7F7F7", accent: "#536471",
    keywords: ["twitter", "tweet", "x ", " x,", "thread"],
    style: "Punchy, witty tweet under 280 characters. Hook in first 5 words. Reference a current trending news angle if relevant. Can use thread format (1/ 2/ 3/) for complex ideas. 1–2 hashtags max.",
    charLimit: 280,
  },
  facebook: {
    id: "facebook", label: "Facebook", icon: "👥",
    color: "#1877F2", bg: "#EEF4FF", accent: "#0D5FD3",
    keywords: ["facebook", "fb", "meta"],
    style: "Conversational, community-friendly post inviting engagement. Mix personal tone with timely, informative content referencing recent developments. Ask a question to drive comments. 1–3 hashtags.",
    charLimit: 63206,
  },
  whatsapp: {
    id: "whatsapp", label: "WhatsApp", icon: "💬",
    color: "#25D366", bg: "#F0FFF4", accent: "#128C7E",
    keywords: ["whatsapp", "whats app", "wa ", "broadcast", "message"],
    style: "Short, personal, direct broadcast message. Warm and friendly as if messaging close contacts. Include a timely fact or recent development to make it feel current. Use *bold* for emphasis. No hashtags. Clear CTA at end.",
    charLimit: 1000,
  },
};

// ── Detect platform from user message ─────────────────────────────────────────
function detectPlatform(text) {
  const lower = text.toLowerCase();
  for (const [id, p] of Object.entries(PLATFORMS)) {
    if (p.keywords.some((kw) => lower.includes(kw))) return id;
  }
  return null;
}

// ── Prompts ───────────────────────────────────────────────────────────────────
function buildRouterPrompt(userMessage) {
  return `You are a social media assistant router. The user said: "${userMessage}"

Extract the platform and topic from the message.
Valid platforms: instagram, linkedin, twitter, facebook, whatsapp

Respond ONLY with a JSON object, no markdown, no backticks:
{
  "platform": "<one of: instagram | linkedin | twitter | facebook | whatsapp | unknown>",
  "topic": "<the topic or subject to write about>",
  "searchQuery": "<a concise web search query to find the latest news and trends on this topic>",
  "tone": "<inferred tone: engaging | professional | fun | inspirational | educational | casual | urgent>",
  "audience": "<inferred target audience or 'general public'>"
}`;
}

function buildAgentPrompt(platform, topic, tone, audience, trendContext) {
  const currentYear = new Date().getFullYear();
  return `You are an expert ${platform.label} content creator and social media strategist with access to the latest real-world information. The current year is ${currentYear} — never reference older years.

PLATFORM RULES for ${platform.label}:
${platform.style}

LATEST TRENDS & DEVELOPMENTS (use these to make the post current and credible):
${trendContext}

Your task: Write a ${platform.label} post about: "${topic}"
Target audience: ${audience || "general public"}
Tone: ${tone || "engaging and authentic"}
Character limit: ${platform.charLimit} characters

IMPORTANT: Naturally weave in 1–2 specific facts, stats, or recent developments from the trend context above.

STRICT OUTPUT FORMAT — respond ONLY with a JSON object, no markdown, no backticks:
{
  "post": "<the complete post text, platform-ready>",
  "hook": "<the opening hook / first line>",
  "hashtags": ["<tag1>", "<tag2>"],
  "tips": ["<one posting tip>", "<one timing tip>"],
  "trendUsed": "<one sentence describing which trend/stat you used and why>",
  "charCount": <character count of post as integer>
}`;
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function callClaude(body) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, ...body }),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  const data = await res.json();
  const raw = data.content.map((b) => b.text || "").join("");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response");
  return JSON.parse(match[0]);
}

async function callClaudeWithSearch(body) {
  const res = await fetch(`${API_BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  const data = await res.json();
  const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in search response");
  return JSON.parse(match[0]);
}

// ── Trend-aware agent ─────────────────────────────────────────────────────────
async function runTrendAwareAgent(platform, topic, tone, audience, searchQuery) {
  const searchPrompt = `Search the web for: "${searchQuery}"

After searching, extract the 3–5 most relevant, recent, and specific facts, statistics, or developments you found.

Respond ONLY with a JSON object, no markdown, no backticks:
{
  "trends": [
    { "fact": "<specific fact or stat>", "source": "<publication or site name>" }
  ],
  "summary": "<2–3 sentence overview of the current state of this topic>"
}`;

  let trendData;
  try {
    trendData = await callClaudeWithSearch({ messages: [{ role: "user", content: searchPrompt }] });
  } catch {
    trendData = { trends: [], summary: "Using general knowledge — no real-time data available." };
  }

  const trendContext = [
    trendData.summary,
    ...(trendData.trends || []).map((t, i) => `${i + 1}. ${t.fact}${t.source ? ` (${t.source})` : ""}`),
  ].join("\n");

  const result = await callClaude({ messages: [{ role: "user", content: buildAgentPrompt(platform, topic, tone, audience, trendContext) }], max_tokens: 4000 });
  result._trends = trendData.trends || [];
  result._trendSummary = trendData.summary;
  return result;
}

// ── TrendBadge ────────────────────────────────────────────────────────────────
function TrendBadge({ trends, trendSummary, trendUsed, color, bg, accent }) {
  const [open, setOpen] = useState(false);
  if (!trends?.length && !trendSummary) return null;
  return (
    <div style={{ borderTop: "1px solid #F3F4F6", paddingTop: 10 }}>
      <button onClick={() => setOpen((v) => !v)} style={{
        background: "none", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 11, color: accent, fontWeight: 600, padding: 0,
      }}>
        <span style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 20, padding: "2px 8px", fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
          🌐 Trend-Aware {open ? "▲" : "▼"}
        </span>
        {!open && trendUsed && <span style={{ color: "#9CA3AF", fontWeight: 400, fontStyle: "italic" }}>{trendUsed}</span>}
      </button>
      {open && (
        <div style={{ marginTop: 8, background: "#F8FAFC", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          {trendSummary && <p style={{ fontSize: 11, color: "#374151", margin: 0, lineHeight: 1.6 }}>{trendSummary}</p>}
          {(trends || []).map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <span style={{ color: accent, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>→</span>
              <span style={{ fontSize: 11, color: "#4B5563", lineHeight: 1.5 }}>
                {t.fact}{t.source && <span style={{ color: "#9CA3AF" }}> · {t.source}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PostBubble ────────────────────────────────────────────────────────────────
function PostBubble({ platform, result }) {
  const [copied, setCopied] = useState(false);
  const p = PLATFORMS[platform];
  if (!p) return null;
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${p.color}33`, borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,0.07)", maxWidth: 560 }}>
      <div style={{ background: p.bg, borderBottom: `1px solid ${p.color}22`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{p.icon}</span>
        <span style={{ fontWeight: 700, color: p.accent, fontSize: 13 }}>{p.label} Post</span>
        <span style={{ fontSize: 10, background: "#E8FFF4", color: "#059669", border: "1px solid #6EE7B7", borderRadius: 20, padding: "2px 8px" }}>🌐 Live trends</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#9CA3AF", background: "#F3F4F6", padding: "2px 8px", borderRadius: 20 }}>
          {result.charCount || result.post?.length || 0} chars
        </span>
      </div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ background: p.bg, borderRadius: 8, padding: "7px 11px", fontSize: 12, color: p.accent, fontStyle: "italic" }}>🎯 {result.hook}</div>
        <div style={{ background: "#F9FAFB", borderRadius: 10, padding: "12px 14px", fontSize: 13, lineHeight: 1.75, color: "#1F2937", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 280, overflowY: "auto" }}>
          {result.post}
        </div>
        {result.hashtags?.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {result.hashtags.map((h, i) => (
              <span key={i} style={{ background: p.bg, color: p.accent, borderRadius: 20, padding: "2px 10px", fontSize: 11, fontWeight: 600 }}>
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        )}
        {result.tips?.length > 0 && <div style={{ fontSize: 11, color: "#6B7280" }}>💡 {result.tips.join(" · ")}</div>}
        <TrendBadge trends={result._trends} trendSummary={result._trendSummary} trendUsed={result.trendUsed} color={p.color} bg={p.bg} accent={p.accent} />
        <button
          onClick={() => { navigator.clipboard.writeText(result.post); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          style={{ alignSelf: "flex-end", padding: "6px 16px", borderRadius: 8, border: `1.5px solid ${p.color}`, background: copied ? p.color : "#fff", color: copied ? "#fff" : p.color, fontWeight: 600, fontSize: 12, cursor: "pointer", transition: "all 0.15s" }}
        >
          {copied ? "✓ Copied!" : "Copy Post"}
        </button>
      </div>
    </div>
  );
}

// ── Chat messages ─────────────────────────────────────────────────────────────
function Avatar() {
  return (
    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #6366F1, #8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🤖</div>
  );
}

function ChatMessage({ msg }) {
  if (msg.role === "user") return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
      <div style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff", borderRadius: "18px 18px 4px 18px", padding: "10px 16px", maxWidth: 440, fontSize: 14, lineHeight: 1.55 }}>{msg.text}</div>
    </div>
  );
  if (msg.role === "assistant") return (
    <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-start" }}>
      <Avatar />
      <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: "4px 18px 18px 18px", padding: "10px 16px", maxWidth: 480, fontSize: 14, lineHeight: 1.6, color: "#374151" }}>{msg.text}</div>
    </div>
  );
  if (msg.role === "thinking") return (
    <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center" }}>
      <Avatar />
      <div style={{ background: "#F3F4F6", borderRadius: "4px 18px 18px 18px", padding: "10px 16px", fontSize: 13, color: "#6B7280", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⚙️</span>{msg.text}
      </div>
    </div>
  );
  if (msg.role === "post") return (
    <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-start" }}>
      <Avatar />
      <PostBubble platform={msg.platform} result={msg.result} />
    </div>
  );
  if (msg.role === "error") return (
    <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>⚠️</div>
      <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: "4px 18px 18px 18px", padding: "10px 16px", fontSize: 13, color: "#DC2626", maxWidth: 440 }}>{msg.text}</div>
    </div>
  );
  return null;
}

// ── Suggestions ───────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  "LinkedIn post on the latest AI agent trends",
  "Instagram post about sustainable fashion in 2025",
  "Tweet about the biggest tech news this week",
  "Facebook post about remote work trends",
  "WhatsApp broadcast about fintech innovations",
];

// ── Main App ──────────────────────────────────────────────────────────────────
export default function SocialMediaChatAgent() {
  const [messages, setMessages] = useState([{
    role: "assistant",
    text: "Hey! 👋 Tell me which platform and topic — I'll search for the latest trends and write a timely, data-backed post for you.\n\nTry: \"Write a LinkedIn post about AI agents\" or \"Instagram post about sustainable fashion\"",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const addMsg = useCallback((msg) => setMessages((p) => [...p, msg]), []);
  const updateLastThinking = useCallback((text) => {
    setMessages((p) => p.map((m, i) => i === p.length - 1 && m.role === "thinking" ? { ...m, text } : m));
  }, []);

  const handleSend = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput("");
    setBusy(true);

    addMsg({ role: "user", text: msg });
    addMsg({ role: "thinking", text: "Understanding your request…" });

    let parsed;
    try {
      parsed = await callClaude({ messages: [{ role: "user", content: buildRouterPrompt(msg) }] });
    } catch (e) {
      setMessages((p) => p.filter((m) => m.role !== "thinking"));
      addMsg({ role: "error", text: `Could not reach the backend. Is it running? (${e.message})` });
      setBusy(false);
      return;
    }

    const platformId = parsed.platform !== "unknown" ? parsed.platform : detectPlatform(msg);
    if (!platformId || !PLATFORMS[platformId]) {
      setMessages((p) => p.filter((m) => m.role !== "thinking"));
      addMsg({ role: "assistant", text: "I couldn't tell which platform you meant. Please mention one of: Instagram, LinkedIn, Twitter/X, Facebook, or WhatsApp. 😊" });
      setBusy(false);
      return;
    }

    const platform = PLATFORMS[platformId];
    updateLastThinking(`🔍 Searching for latest "${parsed.topic}" trends…`);

    let result;
    try {
      result = await runTrendAwareAgent(platform, parsed.topic, parsed.tone, parsed.audience, parsed.searchQuery);
      updateLastThinking(`✍️ Writing your ${platform.label} post…`);
    } catch (e) {
      setMessages((p) => p.filter((m) => m.role !== "thinking"));
      addMsg({ role: "error", text: `Agent error: ${e.message}` });
      setBusy(false);
      return;
    }

    setMessages((p) => p.filter((m) => m.role !== "thinking"));
    addMsg({ role: "post", platform: platformId, result });
    addMsg({ role: "assistant", text: `Here's your ${platform.icon} ${platform.label} post, grounded in the latest trends! Tap "🌐 Trend-Aware" to see the research. Want a different tone, shorter version, or a different platform?` });
    setBusy(false);
    inputRef.current?.focus();
  }, [input, busy, addMsg, updateLastThinking]);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#F8FAFC", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 10px; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #6366F1, #8B5CF6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🤖</div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>Social Media Agent</div>
          <div style={{ fontSize: 11, color: "#10B981", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
            Live trends · 5 platforms
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, background: "#E8FFF4", color: "#059669", border: "1px solid #6EE7B7", borderRadius: 20, padding: "3px 10px", fontWeight: 600 }}>🌐 Web Search On</span>
          {Object.values(PLATFORMS).map((p) => <span key={p.id} title={p.label} style={{ fontSize: 18 }}>{p.icon}</span>)}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>
        {messages.map((msg, i) => <ChatMessage key={i} msg={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length <= 1 && (
        <div style={{ padding: "0 20px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SUGGESTIONS.map((s, i) => (
            <button key={i} onClick={() => handleSend(s)} style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid #E5E7EB", background: "#fff", fontSize: 12, color: "#374151", cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" }}
              onMouseEnter={(e) => { e.target.style.borderColor = "#6366F1"; e.target.style.color = "#6366F1"; }}
              onMouseLeave={(e) => { e.target.style.borderColor = "#E5E7EB"; e.target.style.color = "#374151"; }}
            >{s}</button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ background: "#fff", borderTop: "1px solid #E5E7EB", padding: "14px 20px", display: "flex", gap: 10, alignItems: "flex-end" }}>
        <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey}
          placeholder="e.g. Write a LinkedIn post about the latest AI trends…"
          rows={1} disabled={busy}
          style={{ flex: 1, borderRadius: 12, border: "1.5px solid #E5E7EB", padding: "10px 14px", fontSize: 14, fontFamily: "inherit", resize: "none", outline: "none", color: "#1F2937", background: busy ? "#F9FAFB" : "#fff", lineHeight: 1.5, maxHeight: 120, overflowY: "auto", transition: "border 0.15s" }}
          onFocus={(e) => (e.target.style.borderColor = "#6366F1")}
          onBlur={(e) => (e.target.style.borderColor = "#E5E7EB")}
        />
        <button onClick={() => handleSend()} disabled={!input.trim() || busy}
          style={{ width: 42, height: 42, borderRadius: 12, border: "none", background: !input.trim() || busy ? "#E5E7EB" : "linear-gradient(135deg, #6366F1, #8B5CF6)", color: !input.trim() || busy ? "#9CA3AF" : "#fff", fontSize: 18, cursor: !input.trim() || busy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", flexShrink: 0 }}
        >↑</button>
      </div>
    </div>
  );
}
