const { callAppsScript, ok, err } = require("./_utils");

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 5 minutes

module.exports = async (req, res) => {
  if (req.method !== "GET") return err(res, "Method not allowed", 405);

  // Return cached response if fresh
  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  try {
    const data = await callAppsScript("getCategories", {});
    cache = { success: true, categories: data.categories || [] };
    cacheTime = Date.now();
    return res.status(200).json(cache);
  } catch (e) {
    console.error("categories error:", e.message);
    return err(res, "Failed to fetch categories", 500);
  }
};