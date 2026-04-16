// api/voice/call.js
const TELNYX_API_KEY      = process.env.TELNYX_API_KEY;
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;
const TELNYX_APP_ID       = process.env.TELNYX_APP_ID;
const ORCHESTRATOR_URL    = process.env.ORCHESTRATOR_URL; // e.g. https://abc123.ngrok-free.app

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const {
    phone: rawPhone,
    businessName,
    address,
    category,
    leadId,
    callType = "ai",  // "ai" = Sarah calls | "manual" = you call
  } = req.body;

  if (!rawPhone) {
    return res.status(400).json({ success: false, error: "Phone number is required" });
  }

  // Normalize to E.164
  let phone = String(rawPhone).replace(/[\s\-\(\)\.]/g, "");
  if (!phone.startsWith("+")) {
    const digits = phone.replace(/\D/g, "");
    if      (digits.length === 10)                          phone = "+1" + digits;
    else if (digits.length === 11 && digits[0] === "1")     phone = "+" + digits;
    else                                                     phone = "+" + digits;
  }

  console.log("Calling:", phone, "| Business:", businessName, "| Type:", callType);

  // ── Route AI calls to local orchestrator (via ngrok) if ORCHESTRATOR_URL is set ──
  if (callType === "ai" && ORCHESTRATOR_URL) {
    console.log("Routing to local orchestrator:", ORCHESTRATOR_URL);
    try {
      const orchRes = await fetch(`${ORCHESTRATOR_URL}/dialer/call-now`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name:          businessName || "",
          city:          address      || "",
          business_type: category     || "",
        }),
      });

      const orchData = await orchRes.json();
      console.log("Orchestrator response:", JSON.stringify(orchData));

      if (!orchRes.ok) {
        return res.status(500).json({
          success: false,
          error:   orchData.detail || orchData.message || "Orchestrator error",
        });
      }

      return res.status(200).json({
        success:    true,
        callId:     orchData.channel_id,
        message:    orchData.message || `Calling ${businessName} at ${phone}`,
        via:        "local_orchestrator",
      });
    } catch (e) {
      console.error("Orchestrator error:", e.message);
      return res.status(500).json({ success: false, error: `Orchestrator unreachable: ${e.message}` });
    }
  }

  const clientState = Buffer.from(JSON.stringify({
    leadId:       leadId       || "",
    businessName: businessName || "",
    address:      address      || "",
    category:     category     || "",
    phone,
    callType,             // ← critical: tells webhook which flow to run
    stage:        "verify_name",
    transcript:   [],
    verified:     false,
    email:        null,
    website:      null,
    hasWebsite:   null,
    retries:      0,
  })).toString("base64");

  try {
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        connection_id:               TELNYX_APP_ID,
        to:                          phone,
        from:                        TELNYX_PHONE_NUMBER,
        from_display_name:           "BizDir",
        client_state:                clientState,
        webhook_url:                 "https://yellow-pages.directory/api/voice/webhook",
        webhook_url_method:          "POST",
        timeout_secs:                30,
      }),
    });

    const data = await response.json();
    console.log("Telnyx response:", JSON.stringify(data));

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        error:   data?.errors?.[0]?.detail || "Failed to initiate call",
        debug:   { phone, from: TELNYX_PHONE_NUMBER, appId: TELNYX_APP_ID },
      });
    }

    return res.status(200).json({
      success: true,
      callId:  data.data?.call_control_id || data.data?.id,
      message: `Calling ${businessName} at ${phone}`,
    });

  } catch(e) {
    console.error("Telnyx call error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};