// api/voice/webhook.js
// Main webhook handler for Telnyx Voice API events
// POST https://biz-dir.vercel.app/api/voice/webhook

const { callAppsScript } = require("../_utils");

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

// ElevenLabs voice IDs
const VOICES = {
  us: "21m00Tcm4TlvDq8ikWAM",    // Rachel - American English
  ph: "AZnzlk1XvdvUeBnXmlld",    // Domi - works well for Filipino accent
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const event = req.body;
  const eventType = event?.data?.event_type;
  const callControlId = event?.data?.payload?.call_control_id;
  const callLegId = event?.data?.payload?.call_leg_id;

  console.log("Telnyx event:", eventType, callControlId);

  try {
    switch (eventType) {

      // ── Call is answered ────────────────────────────────
      case "call.answered": {
        const to = event.data.payload.to;
        const from = event.data.payload.from;
        const isUS = to.startsWith("+1") || from.startsWith("+1");
        const voiceId = isUS ? VOICES.us : VOICES.ph;

        // Get business info from call metadata
        const clientState = decodeState(event.data.payload.client_state);
        const businessName = clientState?.businessName || "your business";
        const businessAddress = clientState?.address || "";
        const category = clientState?.category || "";
        const leadId = clientState?.leadId || "";

        // Opening message
        const greeting = isUS
          ? `Hi! This is an automated call from BizDir, a free local business directory. I'm calling to verify and list ${businessName} for free. Is this ${businessName}?`
          : `Magandang araw! Ito ay isang automated call mula sa BizDir, isang libreng business directory. Tatawag kami para i-verify ang ${businessName} at i-list ito nang libre. Ito po ba ay ${businessName}?`;

        // Convert text to speech and play it
        const audioUrl = await textToSpeech(greeting, voiceId);

        await telnyxAction(callControlId, "play_audio", {
          audio_url: audioUrl,
          client_state: encodeState({
            ...clientState,
            stage: "confirm_name",
            voiceId,
            isUS,
            transcript: [],
          }),
        });

        break;
      }

      // ── Audio playback finished ─────────────────────────
      case "call.playback.ended": {
        const clientState = decodeState(event.data.payload.client_state);

        // Start listening for response
        await telnyxAction(callControlId, "gather_using_speech", {
          minimum_silence_ms: 500,
          speech_timeout_ms: 5000,
          client_state: event.data.payload.client_state,
          action_url: `${process.env.VERCEL_URL || "https://biz-dir.vercel.app"}/api/voice/gather`,
        });

        break;
      }

      // ── Call ended ──────────────────────────────────────
      case "call.hangup": {
        const clientState = decodeState(event.data.payload.client_state);
        console.log("Call ended. State:", clientState);

        // If we have enough info, save to BizDir
        if (clientState?.verified && clientState?.leadId) {
          await saveLead(clientState);
        }

        // Update lead status in Sheets
        if (clientState?.leadId) {
          await callAppsScript("updateLeadStatus", {
            id: clientState.leadId,
            status: clientState?.verified ? "verified" : "no_answer",
            transcript: JSON.stringify(clientState?.transcript || []),
          }, "POST");
        }

        break;
      }

      default:
        console.log("Unhandled event:", eventType);
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook error:", e.message);
    res.status(200).json({ received: true }); // Always return 200 to Telnyx
  }
};

// ── Save verified lead to BizDir ──────────────────────────
async function saveLead(state) {
  try {
    await callAppsScript("createListing", {
      ownerEmail: "ai-verified@bizdir.com",
      ownerName: "AI Verified",
      name: state.businessName || "",
      category: state.category || "Services",
      description: state.description || `${state.businessName} - verified by BizDir AI`,
      location: state.address || "",
      phone: state.phone || "",
      website: state.website || "",
      logoUrl: "",
      affiliateUrl: "",
    }, "POST");
    console.log("Lead saved to BizDir:", state.businessName);
  } catch(e) {
    console.error("Failed to save lead:", e.message);
  }
}

// ── Telnyx Call Control action ────────────────────────────
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
    throw new Error(`Telnyx action ${action} failed: ${err}`);
  }
  return res.json();
}

// ── ElevenLabs text to speech ─────────────────────────────
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

  // Convert audio buffer to base64 data URL
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:audio/mpeg;base64,${base64}`;
}

// ── State helpers ─────────────────────────────────────────
function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decodeState(str) {
  if (!str) return {};
  try {
    return JSON.parse(Buffer.from(str, "base64").toString("utf8"));
  } catch { return {}; }
}