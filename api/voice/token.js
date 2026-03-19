// api/voice/token.js
// Generates Telnyx WebRTC JWT token for browser dialer

const TELNYX_API_KEY           = process.env.TELNYX_API_KEY;
const TELNYX_SIP_CONNECTION_ID = process.env.TELNYX_SIP_CONNECTION_ID;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!TELNYX_API_KEY) {
    return res.status(500).json({ error: "Telnyx not configured" });
  }

  try {
    // Step 1 — Create a telephony credential
    const credRes = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        connection_id: TELNYX_SIP_CONNECTION_ID,
      }),
    });

    const credData = await credRes.json();
    console.log("Credential response:", JSON.stringify(credData?.data));

    if (!credRes.ok) {
      return res.status(500).json({
        error: "Failed to create credential",
        details: credData?.errors?.[0]?.detail || "Unknown"
      });
    }

    const credentialId = credData.data?.id;
    if (!credentialId) {
      return res.status(500).json({ error: "No credential ID returned" });
    }

    // Step 2 — Generate a JWT token for this credential
    const tokenRes = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${credentialId}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
    });

    // Telnyx returns the JWT as plain text
    const jwt = await tokenRes.text();
    console.log("JWT generated, length:", jwt.length);

    if (!tokenRes.ok || !jwt) {
      return res.status(500).json({ error: "Failed to generate JWT token" });
    }

    return res.status(200).json({
      login_token: jwt.trim(),
    });

  } catch(e) {
    console.error("Token error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};