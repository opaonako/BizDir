// api/categories.js
const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {
  if (req.method !== "GET") return err(res, "Method not allowed", 405);

  try {
    const data = await callAppsScript("getCategories", {});
    return ok(res, { categories: data.categories || [] });
  } catch (e) {
    console.error("categories error:", e.message);
    return err(res, "Failed to fetch categories", 500);
  }
};
