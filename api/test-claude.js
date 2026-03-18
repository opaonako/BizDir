// api/test-claude.js
// Temporary test endpoint — delete after testing
module.exports = async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        messages: [{ role: "user", content: "Say hello in one word" }],
      }),
    });
    const data = await response.json();
    res.json({ success: true, response: data.content?.[0]?.text, status: response.status });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
};