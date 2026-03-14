// api/auth-sync.js
const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {
  if (req.method !== "POST") return err(res, "Method not allowed", 405);

  const { email, name } = req.body;
  if (!email) return err(res, "Email is required");

  try {
    await callAppsScript("getUser", { email });
    return ok(res, { message: "User already synced" });
  } catch {
    try {
      await callAppsScript("createUser", { email, name: name || "" }, "POST");
      return ok(res, { message: "User synced" }, 201);
    } catch (e) {
      console.error("auth-sync error:", e.message);
      return err(res, "Failed to sync user", 500);
    }
  }
};
