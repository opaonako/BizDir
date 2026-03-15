// api/voice/gather.js
// Handles speech recognition results from Telnyx
// Called after business owner speaks

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const VOICES = {
  us: "21m00Tcm4TlvDq8ikWAM",
  ph: "AZnzlk1XvdvUeBnXmlld",
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const event = req.body;
  const callControlId = event?.data?.payload?.call_control_id;
  const speechResult = event?.data?.payload?.speech?.transcript || "";
  const clientState = decodeState(event?.data?.payload?.client_state);

  console.log("Speech received:", speechResult);
  console.log("Stage:", clientState.stage);

  // Add to transcript
  const transcript = clientState.transcript || [];
  transcript.push({ role: "business", text: speechResult });

  try {
    // Use Claude to determine next action
    const aiResponse = await getAIResponse({
      stage: clientState.stage,
      speech: speechResult,
      businessName: clientState.businessName,
      address: clientState.address,
      category: clientState.category,
      phone: clientState.phone,
      isUS: clientState.isUS,
      transcript,
    });

    console.log("AI response:", aiResponse);

    // Update state
    const newState = {
      ...clientState,
      transcript,
      stage: aiResponse.nextStage,
      verified: aiResponse.verified || false,
      businessName: aiResponse.businessName || clientState.businessName,
      address: aiResponse.address || clientState.address,
      category: aiResponse.category || clientState.category,
      phone: aiResponse.phone || clientState.phone,
      description: aiResponse.description || clientState.description,
    };

    // If call should end
    if (aiResponse.endCall) {
      // Play farewell message
      const audioUrl = await textToSpeech(aiResponse.message, clientState.voiceId || VOICES.us);
      await telnyxAction(callControlId, "play_audio", {
        audio_url: audioUrl,
        client_state: encodeState({ ...newState, ending: true }),
      });

      // Hang up after playing
      setTimeout(async () => {
        await telnyxAction(callControlId, "hangup", {});
      }, 8000);

    } else {
      // Continue conversation
      const audioUrl = await textToSpeech(aiResponse.message, clientState.voiceId || VOICES.us);
      await telnyxAction(callControlId, "play_audio", {
        audio_url: audioUrl,
        client_state: encodeState(newState),
      });
    }

    res.status(200).json({ received: true });
  } catch(e) {
    console.error("Gather error:", e.message);
    // Hang up gracefully on error
    await telnyxAction(callControlId, "hangup", {}).catch(() => {});
    res.status(200).json({ received: true });
  }
};

// ── Claude AI conversation logic ──────────────────────────
async function getAIResponse({ stage, speech, businessName, address, category, phone, isUS, transcript }) {
  const systemPrompt = `You are an AI assistant making verification calls for BizDir, a free business directory.
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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: systemPrompt }],
    }),
  });

  const data = await response.json();
  const text = data.content[0].text;

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return {
      message: "I'm sorry, could you repeat that?",
      nextStage: stage,
      endCall: false,
    };
  }
}

// ── Telnyx action ─────────────────────────────────────────
async function telnyxAction(callControlId, action, params = {}) {
  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify(params),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telnyx ${action} failed: ${err}`);
  }
  return res.json();
}

// ── ElevenLabs TTS ────────────────────────────────────────
async function textToSpeech(text, voiceId) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );
  if (!res.ok) throw new Error("ElevenLabs TTS failed");
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}

function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decodeState(str) {
  if (!str) return {};
  try {
    return JSON.parse(Buffer.from(str, "base64").toString("utf8"));
  } catch { return {}; }
}