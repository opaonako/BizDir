// api/voice/call.js
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_PHONE_NUMBER = process.env.TELNYX_PHONE_NUMBER;
const TELNYX_APP_ID = process.env.TELNYX_APP_ID;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { phone: rawPhone, businessName, address, category, leadId } = req.body;

  // Normalize phone to E164 format
  let phone = String(rawPhone || "").trim();
  if (!phone) return res.status(400).json({ success: false, error: "Phone number is required" });

  // Remove all spaces and dashes
  phone = phone.replace(/[\s\-\(\)]/g, "");

  // Add + if missing
  if (!phone.startsWith("+")) {
    phone = "+" + phone;
  }

  console.log("Raw phone:", rawPhone);
  console.log("Normalized phone:", phone);
  console.log("From:", TELNYX_PHONE_NUMBER);
  console.log("App ID:", TELNYX_APP_ID);

  const clientState = Buffer.from(JSON.stringify({
    leadId: leadId || "",
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
      }),
    });

    const data = await response.json();
    console.log("Telnyx response:", JSON.stringify(data));

    if (!response.ok) {
      return res.status(500).json({
        success: false,
        error: data?.errors?.[0]?.detail || "Failed to initiate call",
        debug: { phone, from: TELNYX_PHONE_NUMBER, appId: TELNYX_APP_ID }
      });
    }

    return res.status(200).json({
      success: true,
      callId: data.data?.id,
      message: `Calling ${businessName} at ${phone}`,
    });

  } catch(e) {
    console.error("Call error:", e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
};