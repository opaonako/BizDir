// api/auth.js
// POST /api/auth?action=signup
// POST /api/auth?action=login
// POST /api/auth?action=validate

const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {
  if (req.method !== "POST") return err(res, "Method not allowed", 405);

  const { action } = req.query;
  const body = req.body;

  // ── Signup ───────────────────────────────────────────────
  if (action === "signup") {
    const { email, password, name } = body;
    if (!email || !password) return err(res, "Email and password are required");
    if (password.length < 8) return err(res, "Password must be at least 8 characters");

    try {
      const data = await callAppsScript("createUser", { email, password, name: name || "" }, "POST");
      return ok(res, { token: data.token, email: data.email, name: data.name }, 201);
    } catch (e) {
      return err(res, e.message || "Signup failed", 400);
    }
  }

  // ── Login ────────────────────────────────────────────────
  if (action === "login") {
    const { email, password } = body;
    if (!email || !password) return err(res, "Email and password are required");

    try {
      const data = await callAppsScript("loginUser", { email, password }, "POST");
      return ok(res, { token: data.token, email: data.email, name: data.name });
    } catch (e) {
      return err(res, e.message || "Login failed", 401);
    }
  }

  // ── Validate token ───────────────────────────────────────
  if (action === "validate") {
    const { token } = body;
    if (!token) return err(res, "Token is required");

    try {
      const data = await callAppsScript("validateToken", { token }, "POST");
      return ok(res, { email: data.email, name: data.name, userId: data.userId });
    } catch (e) {
      return err(res, "Invalid session", 401);
    }
  }

  return err(res, "Unknown action", 400);
};