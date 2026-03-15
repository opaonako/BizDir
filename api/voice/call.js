// api/voice/call.js
// Initiates an outbound call to a business
// POST /api/voice/call

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;
const TELNYX_APP_ID = process.env.TELNYX_APP_ID;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { phone, businessName, address, category, leadId } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, error: "Phone number is required" });
  }

  // Encode business info in client_state so AI has context during the call
  const clientState = Buffer.from(JSON.stringify({
    leadId,
    businessName: businessName || "your business",
    address: address || "",
    category: category || "",
    phone,
    stage: "confirm_name",
    transcript: [],
    verified: false,
  })).toString("base64");

  try {
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        connection_id: TELNYX_APP_ID,
        to: phone,
        from: TELNYX_PHONE_NUMBER,
        from_display_name: "BizDir",
        client_state: clientState,
        webhook_url: "https://biz-dir.vercel.app/api/voice/webhook",
        webhook_url_method: "POST",
        timeout_secs: 30,
        record_audio: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Telnyx call error:", data);
      return res.status(500).json({
        success: false,
        error: data?.errors?.[0]?.detail || "Failed to initiate call",
      });
    }

    return res.status(200).json({
      success: true,
      callId: data.data?.id,
      callControlId: data.data?.call_control_id,
      message: `Calling ${businessName} at ${phone}`,
    });

  } catch(e) {
    console.error("Call error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};