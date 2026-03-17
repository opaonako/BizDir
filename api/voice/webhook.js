// api/voice/webhook.js
// AI Sales Agent - handles inbound calls
// Presents services, collects info, sends payment link

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel - professional American voice

const SERVICES = {
  website: { name: "Website Design", price: 299, description: "Professional business website" },
  ai: { name: "AI Automation", price: 499, description: "Custom AI tools for your business" },
  mobile: { name: "Mobile App", price: 799, description: "iOS and Android mobile app" },
  webapp: { name: "Web Application", price: 599, description: "Custom web application" },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const event = req.body;
  const eventType = event?.data?.event_type;
  const callControlId = event?.data?.payload?.call_control_id;
  const clientState = decodeState(event?.data?.payload?.client_state);
  // ── MANUAL CLICK-TO-DIAL — skip AI, just connect audio ──
if (clientState.callType === "manual") {
  if (eventType === "call.answered") {
    console.log("Manual call answered:", clientState.businessName);
    // Just answer and bridge — no AI, no TTS
    // The admin hears through WebRTC
  }
  res.status(200).json({ received: true });
  return;  // ← exit early, don't run AI flow
}
  console.log("Event:", eventType, "Stage:", clientState.stage);

  res.status(200).json({ received: true });

  try {
    switch (eventType) {

      case "call.answered": {
        const callerNumber = event.data.payload.from;
        const greeting = `Hello! Thank you for calling BizDir. I'm Sarah, your digital services advisor. 
We help businesses grow online with four key services. 
Website design starting at $299, AI automation tools at $499, mobile apps at $799, and custom web applications at $599. 
Which of these sounds most interesting to you, or would you like more details on any of them?`;

        await speak(callControlId, greeting, {
          callerNumber,
          stage: "intro",
          transcript: [],
          interestedService: null,
          customerName: null,
          customerEmail: null,
          customerPhone: callerNumber,
          paymentSent: false,
        });
        break;
      }

      case "call.gather.ended": {
        const speech = event.data.payload.speech?.transcript || "";
        if (!speech) {
          await speak(callControlId, "I'm sorry, I didn't catch that. Could you repeat?", clientState);
          break;
        }

        console.log("Customer said:", speech);
        const transcript = [...(clientState.transcript || []), { role: "customer", text: speech }];
        const aiResponse = await getAIResponse({ ...clientState, speech, transcript });
        console.log("AI response:", JSON.stringify(aiResponse));

        const newState = {
          ...clientState,
          transcript,
          stage: aiResponse.nextStage || clientState.stage,
          customerName: aiResponse.customerName || clientState.customerName,
          customerEmail: aiResponse.customerEmail || clientState.customerEmail,
          interestedService: aiResponse.interestedService || clientState.interestedService,
        };

        // Process payment if we have email
        if (aiResponse.nextStage === "payment" && newState.customerEmail) {
          const service = SERVICES[newState.interestedService] || SERVICES.website;
          const paymentLink = await createPaymentLink(service, newState.customerName, newState.customerEmail);
          await sendPaymentEmail(newState.customerEmail, newState.customerName, service, paymentLink);

          const msg = paymentLink
            ? `Excellent! I've just sent a secure payment link to ${newState.customerEmail}. Please check your inbox — it should arrive within a minute. The link accepts all major credit and debit cards. Once payment is confirmed, our team will reach out within 24 hours to kick off your project. Is there anything else I can help you with?`
            : `Our team will send payment details to ${newState.customerEmail} shortly. Is there anything else I can help you with?`;

          await speak(callControlId, msg, { ...newState, paymentSent: true });
          break;
        }

        if (aiResponse.endCall) {
          await speak(callControlId, aiResponse.message, { ...newState, ending: true });
          setTimeout(() => hangup(callControlId), 10000);
          break;
        }

        await speak(callControlId, aiResponse.message, newState);
        break;
      }

      case "call.playback.ended": {
        if (clientState.ending) {
          setTimeout(() => hangup(callControlId), 1000);
          break;
        }
        await telnyxAction(callControlId, "gather_using_speech", {
          minimum_silence_ms: 800,
          speech_timeout_ms: 10000,
          maximum_tries: 1,
          client_state: event.data.payload.client_state,
        });
        break;
      }

      case "call.hangup": {
        console.log("Call ended:", JSON.stringify(clientState));
        if (clientState.customerEmail || clientState.customerPhone) {
          await saveSalesLead(clientState);
        }
        break;
      }
    }
  } catch(e) {
    console.error("Webhook error:", e.message);
  }
};

async function getAIResponse({ stage, speech, transcript, customerName, customerEmail, customerPhone, interestedService }) {
  const prompt = `You are Sarah, a professional AI sales agent for BizDir digital services company. You are on a phone call.

Services we offer:
1. Website Design - $299 (professional business website, 5 pages, mobile responsive)
2. AI Automation - $499 (custom AI chatbot, workflow automation, lead generation)
3. Mobile App - $799 (iOS and Android, custom design, backend included)
4. Web Application - $599 (custom web app, database, user authentication)

Current stage: ${stage}
Customer name: ${customerName || "not collected"}
Customer email: ${customerEmail || "not collected"}
Customer phone: ${customerPhone}
Interested service: ${interestedService || "not determined"}

Customer just said: "${speech}"

Stage guide:
- intro: Find out which service interests them
- service_details: Explain the service benefits, answer questions, handle objections
- collect_name: Get their first and last name
- collect_email: Get their email for payment link
- payment: Confirm everything and process payment link
- goodbye: Thank them and end call

Respond with JSON only (no markdown):
{
  "message": "your response (warm, professional, conversational, max 3 sentences)",
  "nextStage": "one of: intro|service_details|collect_name|collect_email|payment|goodbye",
  "endCall": false,
  "customerName": "extracted name or null",
  "customerEmail": "extracted valid email or null",
  "interestedService": "website|ai|mobile|webapp or null"
}

Important rules:
- Be warm and conversational, not robotic
- Keep responses SHORT - 2-3 sentences max
- If they show interest, move toward collecting name then email
- If they mention a name, extract it to customerName
- If they spell or say an email, extract it to customerEmail
- Handle objections positively (price too high = mention payment plans, not sure = offer free consultation)
- If they say not interested/goodbye/no thank you = endCall: true with a polite farewell
- Always progress toward the sale`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return { message: "Could you repeat that? I want to make sure I help you correctly.", nextStage: stage, endCall: false };
  }
}

async function createPaymentLink(service, customerName, customerEmail) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) return `https://biz-dir.vercel.app/pages/payment?service=${service.name}&price=${service.price}`;

  try {
    const params = new URLSearchParams({
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": service.name,
      "line_items[0][price_data][product_data][description]": service.description,
      "line_items[0][price_data][unit_amount]": String(service.price * 100),
      "line_items[0][quantity]": "1",
      "mode": "payment",
      "success_url": "https://biz-dir.vercel.app/pages/payment-success",
      "cancel_url": "https://biz-dir.vercel.app",
      "customer_email": customerEmail || "",
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const session = await res.json();
    return session.url || null;
  } catch(e) {
    console.error("Stripe error:", e.message);
    return null;
  }
}

async function sendPaymentEmail(email, name, service, paymentLink) {
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
  if (!APPS_SCRIPT_URL) return;

  const body = JSON.stringify({ action: "sendPaymentEmail", _secret: INTERNAL_SECRET, email, name: name || "Valued Customer", serviceName: service.name, servicePrice: service.price, paymentLink: paymentLink || "https://biz-dir.vercel.app" });

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    redirect: "follow",
  }).catch(e => console.error("Email error:", e.message));
}

async function saveSalesLead(state) {
  const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
  const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
  if (!APPS_SCRIPT_URL) return;

  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "saveSalesLead", _secret: INTERNAL_SECRET, name: state.customerName || "", email: state.customerEmail || "", phone: state.customerPhone || "", service: state.interestedService || "", paymentSent: state.paymentSent || false }),
    redirect: "follow",
  }).catch(e => console.error("Save lead error:", e.message));
}

async function textToSpeech(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_API_KEY },
    body: JSON.stringify({ text, model_id: "eleven_monolingual_v1", voice_settings: { stability: 0.6, similarity_boost: 0.8 } }),
  });
  if (!res.ok) throw new Error("TTS failed: " + await res.text());
  const buffer = await res.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function speak(callControlId, text, newState) {
  const audio = await textToSpeech(text);
  await telnyxAction(callControlId, "play_audio", {
    audio_url: `data:audio/mpeg;base64,${audio}`,
    client_state: encodeState(newState),
    overlay: false,
    loop: false,
  });
}

async function hangup(callControlId) {
  await telnyxAction(callControlId, "hangup", {}).catch(() => {});
}

async function telnyxAction(callControlId, action, params = {}) {
  const res = await fetch(`https://api.telnyx.com/v2/calls/${callControlId}/actions/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TELNYX_API_KEY}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Telnyx ${action} failed: ${await res.text()}`);
  return res.json();
}

function encodeState(obj) { return Buffer.from(JSON.stringify(obj)).toString("base64"); }
function decodeState(str) {
  if (!str) return {};
  try { return JSON.parse(Buffer.from(str, "base64").toString("utf8")); }
  catch { return {}; }
}