// api/voice/gather.js
// Handles speech recognition results from Telnyx
// Called after business owner speaks

const { getAIResponse } = require("./_ai-brain.js");
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

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
    // Use Claude to determine next action (verify mode for this flow)
    const aiResponse = await getAIResponse({
      stage: clientState.stage,
      speech: speechResult,
      businessName: clientState.businessName,
      address: clientState.address,
      category: clientState.category,
      phone: clientState.phone,
      isUS: clientState.isUS,
      transcript,
    }, "verify");  // <-- verify mode (sonnet, 6 stages)

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
