import { setTimeout } from 'timers/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_TO = 'jadhavatharva20@gmail.com';
const MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY env var');
if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY env var');

// ── Quota error helpers ───────────────────────────────────────────────────────
// Gemini returns 429 for both RPM (per-minute) and RPD (per-day) exhaustion.
// RPM errors include a RetryInfo detail with the exact seconds to wait.
// RPD errors have no RetryInfo — retrying never helps; fail fast.

function getRetryDelayMs(errorData) {
  const retryInfo = errorData?.error?.details?.find(
    (d) => d['@type']?.includes('RetryInfo')
  );
  if (!retryInfo) return null; // no RetryInfo → daily quota exhausted
  // retryDelay is a string like "30s" or "60s"
  const seconds = parseInt(retryInfo.retryDelay) || 60;
  return seconds * 1000;
}

// ── Gemini call with retry ────────────────────────────────────────────────────
async function callGemini(contents, useSearch = false, retries = 2) {
  const body = {
    contents,
    generationConfig: { maxOutputTokens: 4000 },
  };
  if (useSearch) body.tools = [{ google_search: {} }];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      return data.candidates?.[0]?.content?.parts
        ?.filter((p) => p.text)
        .map((p) => p.text)
        .join('') || '';
    }

    if (res.status === 429) {
      const rpmDelayMs = getRetryDelayMs(data);
      if (rpmDelayMs === null) {
        // No RetryInfo → daily (RPD) quota exhausted; no point retrying
        throw new Error(
          `Gemini daily quota exhausted — retrying will not recover this.\n` +
          `Quota resets at midnight Pacific time (~12:30 AM IST).\n` +
          `Ensure the GitHub Secret GEMINI_API_KEY uses a different key from backend/.env\n` +
          `so local development does not consume the workflow's daily quota.\n` +
          `Gemini message: ${data?.error?.message || 'RESOURCE_EXHAUSTED'}`
        );
      }
      // RPM limit — Gemini tells us exactly how long to wait
      if (attempt < retries) {
        console.warn(`Gemini RPM limit hit — waiting ${rpmDelayMs / 1000}s before retry (attempt ${attempt + 1}/${retries})`);
        await setTimeout(rpmDelayMs);
        continue;
      }
    }

    if (res.status === 503 && attempt < retries) {
      // Transient infra error — short backoff is appropriate here
      const delay = 5000 * Math.pow(2, attempt); // 5s, 10s
      console.warn(`Gemini 503 (transient) — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${retries})`);
      await setTimeout(delay);
      continue;
    }

    throw new Error(`Gemini API error ${res.status}: ${JSON.stringify(data)}`);
  }
}

// ── Step 1: Find a real article or doc to read ───────────────────────────────
async function findTrendingTopic() {
  const prompt = `Search the web for a real, specific article, blog post, research paper, or official documentation published in the past 7 days about AI engineering or data engineering.

Look for content a student learning AI/data engineering would actually read:
- Official docs or release notes (LangChain, LlamaIndex, dbt, Spark, Iceberg, etc.)
- Engineering blog posts (Anthropic, Google DeepMind, Meta AI, Hugging Face, Databricks, Airflow, etc.)
- Research paper summaries or explanations
- Practical tutorials or deep-dives on tools/frameworks

The article must be REAL and findable — do not invent a title or source.

Respond ONLY with a JSON object, no markdown, no backticks:
{
  "topic": "<specific topic the article covers, e.g. 'How LangGraph handles state in multi-agent workflows'>",
  "keyFact": "<one concrete insight, stat, or finding from the article>",
  "source": "<real publication or website name, e.g. 'Hugging Face Blog', 'Anthropic Research', 'The Databricks Blog'>",
  "articleType": "<'blog post' | 'research paper' | 'official documentation' | 'tutorial'>"
}`;

  const raw = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], true);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in topic response. Raw: ${raw.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

// ── Step 2: Write the LinkedIn post ──────────────────────────────────────────
async function generatePost(topic) {
  const currentYear = new Date().getFullYear();
  const prompt = `You are writing a LinkedIn post for Atharva Jadhav, a student in India building a career in AI engineering. The current year is ${currentYear}.

Topic: "${topic.topic}"
Key insight to share: "${topic.keyFact}"

IMPORTANT RULES — read carefully before writing:
- Do NOT mention any source, article, blog, paper, or documentation
- Do NOT say "I read X" or "I was reading X" or "according to X"
- Do NOT say "I built X" or "while working on X" or "at work I noticed"
- Do NOT claim any specific experience that may not have happened
- Write as a student sharing thoughts on a topic they find interesting — no origin story needed

Write the post in this EXACT structure:

HOOK (1-2 lines): A surprising, counterintuitive, or underrated thing about this topic. State it directly — no need to explain where it came from. Use 1 emoji.

THE CONCEPT (3-4 lines): Explain the topic clearly and simply in your own words. Weave in the key insight naturally. Speak as someone who finds this genuinely interesting. Use 1 emoji.

WHY IT MATTERS FOR LEARNERS (2-3 lines): Why a student getting into AI engineering should care about this. What changes when you understand it? Use 1 emoji.

CTA: One open question for the reader about this topic.

HASHTAGS: 3-5 relevant hashtags. Always include #LearningInPublic.

Tone: curious, direct, first-person — a student thinking out loud about something interesting, not an expert or a journalist. Total: 150-250 words.

Respond ONLY with a JSON object, no markdown, no backticks:
{
  "post": "<full post text, use \\n for line breaks between sections>",
  "subject": "<punchy email subject line, e.g. 'Today\\'s Post: Why LangGraph is winning the agent wars'>"
}`;

  const raw = await callGemini([{ role: 'user', parts: [{ text: prompt }] }], false);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in post response. Raw: ${raw.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

// ── Step 3: Send email via Resend ─────────────────────────────────────────────
async function sendEmail(subject, postText, topic) {
  const htmlPost = postText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const html = `
    <div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;padding:24px;background:#ffffff">
      <div style="background:#0A66C2;color:white;padding:14px 20px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">💼</span>
        <strong style="font-size:15px">Your Daily LinkedIn Post</strong>
      </div>
      <div style="border:1px solid #dce6f1;border-top:none;padding:24px;border-radius:0 0 8px 8px;background:#f8faff">
        <p style="color:#555;font-size:13px;margin:0 0 16px 0">
          📌 <strong>Topic:</strong> ${topic.topic}<br>
          <span style="color:#888;font-size:11px">Source: ${topic.source} · ${topic.keyFact}</span>
        </p>
        <div style="background:white;border-radius:10px;padding:22px;font-size:15px;line-height:1.85;color:#1a1a1a;border-left:4px solid #0A66C2;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
          ${htmlPost}
        </div>
        <p style="color:#aaa;font-size:11px;margin:18px 0 0 0;text-align:center">
          Generated by your LinkedIn content agent · AI & Data Engineering
        </p>
      </div>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: EMAIL_TO,
      subject,
      html,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 Step 1: Finding trending topic in AI/data engineering...');
  const topic = await findTrendingTopic();
  console.log(`✅ Topic: ${topic.topic}`);
  console.log(`   Source: ${topic.articleType} from ${topic.source}`);
  console.log(`   Fact: ${topic.keyFact}`);

  console.log('\n✍️  Step 2: Generating LinkedIn post...');
  const { post, subject } = await generatePost(topic);
  console.log('✅ Post generated');
  console.log(`   Subject: ${subject}`);

  console.log('\n📧 Step 3: Sending email...');
  const result = await sendEmail(subject, post, topic);
  console.log(`✅ Email sent successfully — ID: ${result.id}`);
  console.log(`   Delivered to: ${EMAIL_TO}`);
}

main().catch((err) => {
  console.error('❌ Agent failed:', err.message);
  process.exit(1);
});
