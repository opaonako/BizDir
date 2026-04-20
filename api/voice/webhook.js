// api/voice/webhook.js
// BizDir AI Sales Agent — ElevenLabs voice + Cloudflare R2 storage
// Vercel runtime config set via module.exports.config below

const { getAIResponse } = require("./_ai-brain.js");  // defaults to "sales" mode (Sarah, haiku)
const TELNYX_API_KEY      = process.env.TELNYX_API_KEY;
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY;
const APPS_SCRIPT_URL     = process.env.APPS_SCRIPT_URL;
const INTERNAL_SECRET     = process.env.INTERNAL_SECRET;

// Cloudflare R2
const R2_ACCOUNT_ID       = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID    = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY= process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME      = process.env.R2_BUCKET_NAME      || "bizdir-audio";
const R2_PUBLIC_URL       = process.env.R2_PUBLIC_URL;       // e.g. https://pub-xxxx.r2.dev

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel — ElevenLabs

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  // ── Respond immediately — Telnyx requires 200 before any API calls ──
  res.status(200).json({ received: true });

  const event         = req.body;
  const eventType     = event?.data?.event_type;
  const payload       = event?.data?.payload;
  const callControlId = payload?.call_control_id;
  const clientState   = decodeState(payload?.client_state);

  console.log("Event:", eventType, "| Stage:", clientState.stage, "| Lead:", clientState.businessName);

  if (clientState.callType === "manual") return;

  try {
    switch (eventType) {

      case "call.answered": {
        const state = { ...clientState, stage: "verify_name", transcript: [], retries: 0 };
        await speak(callControlId,
          `Hi there! This is Sarah calling from Yellow Pages, a free local business directory. ` +
          `Am I speaking with someone from ${clientState.businessName || "the business"}?`,
          state
        );
        break;
      }

      case "call.machine.detection.ended": {
        const result = payload?.result;
        if (result === "machine_start" || result === "machine_end_beep") {
          await speak(callControlId,
            `Hi, this is Sarah from Yellow Pages, a free local business directory. ` +
            `We'd love to list ${clientState.businessName || "your business"} for free. ` +
            `Please call us back or visit yellow-pages.directory. Have a great day!`,
            { ...clientState, ending: true }
          );
          setTimeout(() => hangup(callControlId), 12000);
        }
        break;
      }

      case "call.transcription": {
        const transcript = payload?.transcription_data?.transcript || "";
        const isFinal    = payload?.transcription_data?.is_final;
        if (!isFinal || !transcript || transcript.trim().length < 2) break;

        console.log("Transcription:", transcript);
        await telnyxAction(callControlId, "transcription_stop", {}).catch(() => {});

        const cs = decodeState(payload?.client_state);
        console.log(`[${cs.stage}] Customer: "${transcript}"`);

        const transcriptArr = [...(cs.transcript || []), { role: "customer", text: transcript, stage: cs.stage }];
        const ai = await getAIResponse({ ...cs, speech: transcript, transcript: transcriptArr });
        console.log("AI decision:", JSON.stringify(ai));

        const newState = buildNewState(cs, ai);

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
          await speak(callControlId,
            "Sorry, I didn't catch that. Could you say that again?",
            { ...clientState, retries }
          );
          break;
        }

        console.log(`[${clientState.stage}] Customer: "${speech}"`);
        const transcript = [...(clientState.transcript || []), { role: "customer", text: speech, stage: clientState.stage }];
        const ai = await getAIResponse({ ...clientState, speech, transcript });
        console.log("AI decision:", JSON.stringify(ai));

        const newState = buildNewState(clientState, ai, transcript);

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
        if (clientState.ending) { setTimeout(() => hangup(callControlId), 1000); break; }
        await startListening(callControlId, payload?.client_state);
        break;
      }

      case "call.speak.ended": {
        if (clientState.ending) { setTimeout(() => hangup(callControlId), 1000); break; }
        await startListening(callControlId, payload?.client_state);
        break;
      }

      case "call.hangup": {
        console.log("Call ended. Turns:", clientState.transcript?.length);
        if (clientState.leadId && clientState.transcript?.length > 0) {
          await syncToSheet({ ...clientState, outcome: clientState.outcome || "completed" });
        }
        break;
      }
    }
  } catch(e) {
    console.error("Webhook error:", e.message, e.stack);
  }
};

// ── SPEAK — ElevenLabs → R2 → Telnyx playback, fallback to Telnyx TTS ──
async function speak(callControlId, text, newState) {
  console.log("Sarah:", text.substring(0, 120));

  if (ELEVENLABS_API_KEY && R2_PUBLIC_URL) {
    try {
      const audioUrl = await generateAndUploadAudio(text);
      await telnyxAction(callControlId, "playback_start", {
        audio_url:    audioUrl,
        client_state: encodeState(newState),
      });
      console.log("Playing ElevenLabs audio:", audioUrl);
      return;
    } catch(e) {
      console.error("ElevenLabs/R2 failed, falling back to Telnyx TTS:", e.message);
    }
  }

  // Fallback — Telnyx built-in TTS
  await telnyxAction(callControlId, "speak", {
    payload:      text,
    voice:        "female",
    language:     "en-US",
    client_state: encodeState(newState),
  });
}

// ── ELEVENLABS — generate MP3 ──────────────────────────────────
async function generateElevenLabsAudio(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method:  "POST",
    headers: {
      "xi-api-key":   ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      "Accept":       "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

// ── CLOUDFLARE R2 — upload and return public URL ───────────────
async function uploadToR2(audioBuffer) {
  const filename  = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
  const endpoint  = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const uploadUrl = `${endpoint}/${R2_BUCKET_NAME}/${filename}`;

  // Sign the request with AWS Signature V4 (R2 is S3-compatible)
  const { signedHeaders, signature, dateStamp, amzDate } = await signR2Request({
    method:   "PUT",
    bucket:   R2_BUCKET_NAME,
    key:      filename,
    region:   "auto",
    service:  "s3",
    endpoint,
    body:     audioBuffer,
  });

  const res = await fetch(uploadUrl, {
    method:  "PUT",
    headers: {
      "Content-Type":        "audio/mpeg",
      "Content-Length":      audioBuffer.byteLength.toString(),
      "x-amz-date":          amzDate,
      "x-amz-content-sha256":signedHeaders["x-amz-content-sha256"],
      "Authorization":       `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${dateStamp}/auto/s3/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
      "Host":                `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    },
    body: audioBuffer,
  });

  if (!res.ok) throw new Error(`R2 upload failed: ${res.status} ${await res.text()}`);

  // Return public URL
  const publicUrl = `${R2_PUBLIC_URL}/${filename}`;

  // R2 cleanup: files are deleted by /api/voice/cleanup-r2.js (called via cron)
  // Old setTimeout was unreliable in serverless environments

  return publicUrl;
}

// deleteFromR2 moved to cleanup-r2.js (called via cron)

// Full pipeline: ElevenLabs → R2 → public URL
async function generateAndUploadAudio(text) {
  const audioBuffer = await generateElevenLabsAudio(text);
  const publicUrl   = await uploadToR2(audioBuffer);
  return publicUrl;
}

// ── AWS Signature V4 for R2 (no external dependencies) ─────────
async function signR2Request({ method, bucket, key, region, service, endpoint, body }) {
  const crypto = require("crypto");

  const now     = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const host    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const bodyHash = crypto
    .createHash("sha256")
    .update(Buffer.from(body))
    .digest("hex");

  const canonicalHeaders = [
    `content-type:audio/mpeg`,
    `host:${host}`,
    `x-amz-content-sha256:${bodyHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n") + "\n";

  const signedHeadersList = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    `/${bucket}/${key}`,
    "",
    canonicalHeaders,
    signedHeadersList,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  function hmac(key, data) {
    return crypto.createHmac("sha256", key).update(data).digest();
  }

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStamp), region), service),
    "aws4_request"
  );

  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  return {
    signature,
    dateStamp,
    amzDate,
    signedHeaders: { "x-amz-content-sha256": bodyHash },
  };
}

// ── HELPERS ────────────────────────────────────────────────────
function buildNewState(current, ai, transcript) {
  return {
    ...current,
    transcript: transcript || current.transcript,
    stage:      ai.nextStage   || current.stage,
    email:      ai.email       || current.email,
    website:    ai.website     || current.website,
    hasWebsite: ai.hasWebsite  !== undefined ? ai.hasWebsite : current.hasWebsite,
    address:    ai.address     || current.address,
    verified:   ai.verified    !== undefined ? ai.verified   : current.verified,
    retries:    0,
    outcome:    ai.outcome     || current.outcome,
  };
}

async function startListening(callControlId, encodedState) {
  await telnyxAction(callControlId, "transcription_start", {
    language:             "en-US",
    transcription_tracks: "inbound",
    client_state:         encodedState,
  });
}

// ── AI BRAIN ───────────────────────────────────────────────────
// getAIResponse is now imported from _ai-brain.js (shared with gather.js)


// ── SYNC TO SHEET ──────────────────────────────────────────────
async function syncToSheet(state) {
  if (!APPS_SCRIPT_URL || !state.leadId) return;

  const fullTranscript = (state.transcript || [])
    .map(t => `${t.role === "customer" ? "Customer" : "Sarah"}: ${t.text}`)
    .join("\n");

  const description = [
    state.businessName || "",
    state.category     ? `Category: ${state.category}` : "",
    state.address      ? `Address:  ${state.address}`  : "",
    state.phone        ? `Phone:    ${state.phone}`     : "",
    state.email        ? `Email:    ${state.email}`     : "",
    state.hasWebsite   ? `Website:  ${state.website || "yes"}` : "No website",
  ].filter(Boolean).join("\n");

  try {
    await fetch(APPS_SCRIPT_URL, {
      method:   "POST",
      headers:  { "Content-Type": "application/json" },
      redirect: "follow",
      body: JSON.stringify({
        action:     "updateCallResult",
        _secret:    INTERNAL_SECRET,
        id:         state.leadId,
        status:     state.outcome === "approved" ? "approved" : "pending",
        description,
        transcript: fullTranscript,
        email:      state.email   || "",
        website:    state.website || "",
        calledAt:   new Date().toISOString(),
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

// ── TELNYX HELPERS ─────────────────────────────────────────────
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
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telnyx ${action} failed: ${errText}`);
  }
  return res.json();
}

// ── STATE HELPERS ──────────────────────────────────────────────
function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decodeState(str) {
  if (!str) return {};
  try { return JSON.parse(Buffer.from(str, "base64").toString("utf8")); }
  catch { return {}; }
}
module.exports.config = { runtime: 'nodejs', maxDuration: 60 };
