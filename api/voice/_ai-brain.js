// api/voice/_ai-brain.js
// Shared AI brain for BizDir voice agents.
// Used by both webhook.js (sales mode) and gather.js (verify mode).
//
// Two modes:
//   "sales"  - Sarah, a sales agent for Yellow Pages (8 stages, haiku)
//   "verify" - BizDir verification assistant (6 stages, sonnet)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// -- Mode configs ---------------------------------------------
const MODE_CONFIG = {
  sales: {
    model:      "claude-haiku-4-5-20251001",
    max_tokens:  400,
    stages: [
      "verify_name", "verify_address", "ask_website",
      "ask_email", "approve", "upsell", "followup_email", "goodbye",
    ],
  },
  verify: {
    model:      "claude-sonnet-4-20250514",
    max_tokens:  500,
    stages: [
      "confirm_name", "confirm_address", "confirm_category",
      "confirm_phone", "get_description", "farewell",
    ],
  },
};

// -- Build the system prompt (sales mode) ----------------------
function buildSalesPrompt({ stage, speech, businessName, address, phone, email, website, hasWebsite, category, transcript }) {
  const recentTranscript = (transcript || [])
    .slice(-6)
    .map(t => `${t.role === "customer" || t.role === "business" ? "Customer" : "Sarah"}: ${t.text}`)
    .join("\n");

  return `You are Sarah, a friendly AI agent for Yellow Pages — a free local business directory.
You called ${businessName || "a local business"} to verify their info and offer a free listing.

INFO WE HAVE:
- Business: ${businessName || "unknown"}
- Address:  ${address || "unknown"}
- Phone:    ${phone || "unknown"}
- Category: ${category || "unknown"}
- Email:    ${email || "not collected yet"}
- Website:  ${hasWebsite === null ? "not asked yet" : hasWebsite ? "yes — " + (website || "url not collected") : "no"}

CURRENT STAGE: ${stage}
RECENT CONVERSATION:
${recentTranscript}
CUSTOMER JUST SAID: "${speech}"

STAGE FLOW (follow in order):
1. verify_name    — Confirm speaking with someone from the business. If yes → verify_address.
2. verify_address — Confirm their address is "${address}". If different collect correct one.
3. ask_website    — Ask if they have a website. If yes ask for URL.
4. ask_email      — Ask for their email for the free listing confirmation.
5. approve        — All info collected. Thank them and tell them listing is live on Yellow Pages.
6. upsell         — IF NO WEBSITE: Offer free pre-built website. IF HAS WEBSITE: Offer web app $599, AI automation $499, SEO $199/mo.
7. followup_email — They want to think about it. Confirm we will email them details.
8. goodbye        — Warm closing. "Have a great day!"

RULES:
- MAX 2 sentences per response. Be natural and conversational.
- If they seem busy: offer to email details and end call politely.
- If wrong number or not interested: endCall immediately.
- Extract email carefully — reconstruct if spelled out letter by letter.
- Once you have email and address confirmed → nextStage must be "approve".

RESPOND IN JSON ONLY — no markdown, no extra text:
{
  "message":    "Sarah spoken response max 2 sentences",
  "nextStage":  "verify_name|verify_address|ask_website|ask_email|approve|upsell|followup_email|goodbye",
  "endCall":    false,
  "email":      "extracted email or null",
  "website":    "extracted URL or null",
  "hasWebsite": true,
  "address":    "corrected address or null",
  "verified":   true,
  "outcome":    "approved|not_interested|busy|wrong_number|followup|null"
}`;
}

// -- Build the system prompt (verify mode) ---------------------
function buildVerifyPrompt({ stage, speech, businessName, address, category, phone, isUS, transcript }) {
  return `You are an AI assistant making verification calls for BizDir, a free business directory.
Your job is to collect and verify business information through a natural phone conversation.

Current business info:
- Name: ${businessName}
- Address: ${address || "unknown"}
- Category: ${category || "unknown"}
- Phone: ${phone || "unknown"}

Conversation stages:
1. confirm_name - Confirm the business name
2. confirm_address - Confirm the address
3. confirm_category - Ask what type of business they are
4. confirm_phone - Confirm their phone number
5. get_description - Ask for a brief description
6. farewell - Thank them and end call

Current stage: ${stage}
Latest response: "${speech}"

Respond with a JSON object:
{
  "message": "what to say next (keep it short and natural)",
  "nextStage": "next stage name",
  "endCall": false,
  "verified": false,
  "businessName": "extracted or confirmed name",
  "address": "extracted or confirmed address",
  "category": "extracted category",
  "phone": "extracted phone",
  "description": "extracted description"
}

Rules:
- Keep responses SHORT (1-2 sentences max)
- Be friendly and professional
- If they say no, wrong number, or not interested - set endCall: true
- After getting all info (farewell stage) - set endCall: true and verified: true
- ${isUS ? "Use American English" : "Use clear English, Filipino-friendly"}
- Extract any business info mentioned in their response`;
}

// -- Call Claude and parse response ----------------------------
async function getAIResponse(state, mode = "sales") {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.sales;
  const { stage } = state;

  const prompt = mode === "verify"
    ? buildVerifyPrompt(state)
    : buildSalesPrompt(state);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      config.model,
        max_tokens: config.max_tokens,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    const data  = await res.json();
    const text  = data.content?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error("[AI Brain] Claude error:", e.message);
    const fallback = mode === "verify"
      ? { message: "I'm sorry, could you repeat that?", nextStage: stage, endCall: false }
      : { message: "Could you repeat that? I want to make sure I have your details right.", nextStage: stage, endCall: false, email: null, website: null, hasWebsite: null, address: null, verified: false };
    return fallback;
  }
}

module.exports = { getAIResponse, MODE_CONFIG, buildSalesPrompt, buildVerifyPrompt };
