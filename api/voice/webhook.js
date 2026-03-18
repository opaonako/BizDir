// api/voice/webhook.js
// BizDir AI Sales Agent — Outbound call handler
// Handles real-time AI conversation via Telnyx
// On call end → calls Apps Script to update sheet directly

const TELNYX_API_KEY    = process.env.TELNYX_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const APPS_SCRIPT_URL    = process.env.APPS_SCRIPT_URL;
const INTERNAL_SECRET    = process.env.INTERNAL_SECRET;

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — ElevenLabs

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const event         = req.body;
  const eventType     = event?.data?.event_type;
  const payload       = event?.data?.payload;
  const callControlId = payload?.call_control_id;
  const clientState   = decodeState(payload?.client_state);

  console.log("Event:", eventType, "| Stage:", clientState.stage, "| Lead:", clientState.businessName);

  if (clientState.callType === "manual") {
  return res.status(200).json({ received: true });
}

try {
  switch (eventType) {

    case "call.transcription": {
  const transcript = payload?.transcription_data?.transcript || "";
  const isFinal    = payload?.transcription_data?.is_final;
  
  if (!isFinal || !transcript) break;
  
  console.log("Transcription:", transcript);
  
  // Stop transcription
  await telnyxAction(callControlId, "transcription_stop", {});
  
  // Re-emit as gather.ended so existing logic handles it
  const fakeGatherEvent = {
    data: {
      event_type: "call.gather.ended",
      payload: {
        call_control_id: callControlId,
        speech: { transcript },
        client_state: payload?.client_state,
      }
    }
  };
  
  // Process through existing gather logic
  const speech = transcript;
  const cs = decodeState(payload?.client_state);
  
  if (!speech || speech.trim().length < 2) break;
  
  console.log(`[${cs.stage}] Customer: "${speech}"`);
  
  const transcriptArr = [...(cs.transcript || []), { role: "customer", text: speech, stage: cs.stage }];
  const ai = await getAIResponse({ ...cs, speech, transcript: transcriptArr });
  console.log("AI decision:", JSON.stringify(ai));
  
  const newState = {
    ...cs,
    transcript: transcriptArr,
    stage:      ai.nextStage   || cs.stage,
    email:      ai.email       || cs.email,
    website:    ai.website     || cs.website,
    hasWebsite: ai.hasWebsite  !== undefined ? ai.hasWebsite : cs.hasWebsite,
    address:    ai.address     || cs.address,
    verified:   ai.verified    !== undefined ? ai.verified   : cs.verified,
    retries:    0,
    outcome:    ai.outcome     || cs.outcome,
  };
  
  if (ai.nextStage === "approve") {
    syncToSheet({ ...newState, outcome: "approved" }).catch(console.error);
  }
  
  if (ai.endCall) {
    await speak(callControlId, ai.message, { ...newState, ending: true });
    setTimeout(async () => {
      await hangup(callControlId);
      await syncToSheet({ ...newState, outcome: newState.outcome || "completed" });
    }, 8000);
    break;
  }
  
  await speak(callControlId, ai.message, newState);
  break;
}

      case "call.machine.detection.ended": {
        const result = payload?.result;
        if (result === "machine_start" || result === "machine_end_beep") {
          await speak(callControlId,
            `Hi, this is Sarah from BizDir, a free local business directory. ` +
            `We'd love to list ${clientState.businessName || "your business"} for free. ` +
            `Please call us back or visit biz-dir.vercel.app. Have a great day!`,
            { ...clientState, ending: true }
          );
          setTimeout(() => hangup(callControlId), 12000);
        }
        break;
      }

      case "call.answered": {
          const state = { ...clientState, stage: "verify_name", transcript: [], retries: 0 };
          await speak(callControlId,
            `Hi there! This is Sarah calling from BizDir, a free local business directory. ` +
            `Am I speaking with someone from ${clientState.businessName || "the business"}?`,
            state
          );
          // Start transcription to listen for customer response
          await telnyxAction(callControlId, "transcription_start", {
            language:             "en-US",
            transcription_tracks: "inbound",
            client_state:         encodeState(state),
          });
          break;
    
      }

      case "call.gather.ended": {
        const speech = payload?.speech?.transcript || "";

        if (!speech || speech.trim().length < 2) {
          const retries = (clientState.retries || 0) + 1;
          if (retries >= 2) {
            await speak(callControlId,
              "I'm sorry I couldn't hear you. We'll try again another time. Have a great day!",
              { ...clientState, ending: true }
            );
            setTimeout(async () => {
              await hangup(callControlId);
              await syncToSheet({ ...clientState, outcome: "no_answer" });
            }, 6000);
            break;
          }
          await speak(callControlId, "Sorry, I didn't catch that. Could you say that again?",
            { ...clientState, retries }
          );
          break;
        }

        console.log(`[${clientState.stage}] Customer: "${speech}"`);

        const transcript = [
          ...(clientState.transcript || []),
          { role: "customer", text: speech, stage: clientState.stage }
        ];

        const ai = await getAIResponse({ ...clientState, speech, transcript });
        console.log("AI decision:", JSON.stringify(ai));

        const newState = {
          ...clientState,
          transcript,
          stage:      ai.nextStage   || clientState.stage,
          email:      ai.email       || clientState.email,
          website:    ai.website     || clientState.website,
          hasWebsite: ai.hasWebsite  !== undefined ? ai.hasWebsite : clientState.hasWebsite,
          address:    ai.address     || clientState.address,
          verified:   ai.verified    !== undefined ? ai.verified   : clientState.verified,
          retries:    0,
          outcome:    ai.outcome     || clientState.outcome,
        };

        if (ai.nextStage === "approve") {
          syncToSheet({ ...newState, outcome: "approved" }).catch(console.error);
        }

        if (ai.endCall) {
          await speak(callControlId, ai.message, { ...newState, ending: true });
          setTimeout(async () => {
            await hangup(callControlId);
            await syncToSheet({ ...newState, outcome: newState.outcome || "completed" });
          }, 8000);
          break;
        }

        await speak(callControlId, ai.message, newState);
        break;
      }

      case "call.playback.ended": {
        if (clientState.ending) {
          setTimeout(() => hangup(callControlId), 1000);
          break;
        }
        await telnyxGather(callControlId, payload?.client_state);
        break;
      }

      case "call.speak.ended": {
        if (clientState.ending) {
          setTimeout(() => hangup(callControlId), 1000);
          break;
        }
        await telnyxGather(callControlId, payload?.client_state);
        break;
      }

      case "call.hangup": {
        console.log("Call ended. Turns:", clientState.transcript?.length);
        if (clientState.leadId && clientState.transcript?.length > 0) {
          await syncToSheet({
            ...clientState,
            outcome: clientState.outcome || "completed",
          });
        }
        break;
      }
    }
  } catch(e) {
    console.error("Webhook error:", e.message);
  }
res.status(200).json({ received: true });
};

// ── AI BRAIN ──────────────────────────────────────────────────
async function getAIResponse(state) {
  const { stage, speech, businessName, address, phone,
          email, website, hasWebsite, transcript, category } = state;

  const recentTranscript = (transcript || [])
    .slice(-6)
    .map(t => `${t.role === "customer" ? "Customer" : "Sarah"}: ${t.text}`)
    .join("\n");

  const prompt = `You are Sarah, a friendly AI agent for BizDir — a free local business directory.
You called ${businessName || "a local business"} to verify their info and offer a free listing.

INFO WE HAVE:
- Business: ${businessName || "unknown"}
- Address: ${address || "unknown"}
- Phone: ${phone || "unknown"}
- Category: ${category || "unknown"}
- Email: ${email || "not collected yet"}
- Website: ${hasWebsite === null ? "not asked yet" : hasWebsite ? "yes — " + (website || "url not collected") : "no"}

CURRENT STAGE: ${stage}
RECENT CONVERSATION:
${recentTranscript}
CUSTOMER JUST SAID: "${speech}"

STAGE FLOW (follow in order):
1. verify_name — Confirm speaking with someone from the business. If yes move to verify_address.
2. verify_address — Confirm their address is "${address}". If different collect correct one.
3. ask_website — Ask if they have a website. If yes ask for URL.
4. ask_email — Ask for their email for the free listing confirmation.
5. approve — All info collected. Thank them. Tell listing is live on BizDir. Then move to upsell.
6. upsell — IF NO WEBSITE: Offer free pre-built website. IF HAS WEBSITE: Offer web app $599, AI automation $499, SEO $199/mo.
7. followup_email — They want to think about it. Confirm we'll email them details.
8. goodbye — Warm closing. "Have a great day!"

RULES:
- MAX 2 sentences per response. Be natural and conversational.
- If they seem busy: offer to email details and end call politely.
- If wrong number / not interested: endCall immediately.
- Extract email carefully — reconstruct if spelled out.
- Once you have email and address confirmed → nextStage must be "approve"

RESPOND JSON ONLY:
{
  "message": "Sarah's spoken response — max 2 sentences",
  "nextStage": "verify_name|verify_address|ask_website|ask_email|approve|upsell|followup_email|goodbye",
  "endCall": false,
  "email": "extracted email or null",
  "website": "extracted URL or null",
  "hasWebsite": true,
  "address": "corrected address or null",
  "verified": true,
  "outcome": "approved|not_interested|busy|wrong_number|followup|null"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch(e) {
    console.error("Claude error:", e.message);
    return {
      message:    "Could you repeat that? I want to make sure I have your details right.",
      nextStage:  stage,
      endCall:    false,
      email:      null,
      website:    null,
      hasWebsite: null,
      address:    null,
      verified:   false,
    };
  }
}

// ── SYNC TO SHEET ─────────────────────────────────────────────
async function syncToSheet(state) {
  if (!APPS_SCRIPT_URL || !state.leadId) return;

  const fullTranscript = (state.transcript || [])
    .map(t => `${t.role === "customer" ? "Customer" : "Sarah"}: ${t.text}`)
    .join("\n");

  const description = [
    state.businessName || "",
    state.category     ? `Category: ${state.category}` : "",
    state.address      ? `Address: ${state.address}`   : "",
    state.phone        ? `Phone: ${state.phone}`        : "",
    state.email        ? `Email: ${state.email}`        : "",
    state.hasWebsite   ? `Website: ${state.website || "yes"}` : "No website",
  ].filter(Boolean).join("\n");

  try {
    await fetch(APPS_SCRIPT_URL, {
      method:   "POST",
      headers:  { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        action:      "updateCallResult",
        _secret:     INTERNAL_SECRET,
        id:          state.leadId,
        status:      state.outcome === "approved" ? "approved" : "pending",
        description,
        transcript:  fullTranscript,
        email:       state.email   || "",
        website:     state.website || "",
        calledAt:    new Date().toISOString(),
      }),
    });
    console.log("Sheet synced:", state.businessName, "→", state.outcome);

    if (state.outcome === "approved" && state.email) {
      await fetch(APPS_SCRIPT_URL, {
        method:   "POST",
        headers:  { "Content-Type": "application/json" },
        redirect: "follow",
        body: JSON.stringify({
          action:  "sendWelcomeEmail",
          _secret: INTERNAL_SECRET,
          email:   state.email,
          name:    state.businessName || "Business Owner",
        }),
      });
      console.log("Welcome email sent to:", state.email);
    }
  } catch(e) {
    console.error("Sheet sync error:", e.message);
  }
}

// ── TELNYX HELPERS ────────────────────────────────────────────
async function speak(callControlId, text, newState) {
  console.log("Sarah:", text.substring(0, 100));
  await telnyxAction(callControlId, "speak", {
    payload:      text,
    voice:        "female",
    language:     "en-US",
    client_state: encodeState(newState),
  });
}

async function telnyxGather(callControlId, encodedState) {
  // Start transcription to capture customer speech
  await telnyxAction(callControlId, "transcription_start", {
    language:        "en-US",
    transcription_tracks: "inbound",
    client_state:    encodedState,
  });
}}

async function hangup(callControlId) {
  await telnyxAction(callControlId, "hangup", {}).catch(() => {});
}

async function telnyxAction(callControlId, action, params = {}) {
  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`,
    {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify(params),
    }
  );
  if (!res.ok) throw new Error(`Telnyx ${action} failed: ${await res.text()}`);
  return res.json();
}

// ── STATE HELPERS ─────────────────────────────────────────────
function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decodeState(str) {
  if (!str) return {};
  try {
    return JSON.parse(Buffer.from(str, "base64").toString("utf8"));
  } catch {
    return {};
  }
}