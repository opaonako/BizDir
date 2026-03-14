const { callAppsScript, ok, err } = require("./_utils");

const cache = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const { id, category, search, page = "1", limit = "12" } = req.query;

    // Build cache key from query params
    const cacheKey = `${category||""}_${search||""}_${page}_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.status(200).json(cached.data);
    }

    try {
      const data = await callAppsScript("getListings", {
        id: id || "",
        category: category || "",
        search: search || "",
        page,
        limit,
      });



      sdadadasa

      
      const response = {
        success: true,
        businesses: data.businesses || [],
        total: data.total || 0,
        page: Number(page),
        totalPages: data.totalPages || 1,
      };

      cache.set(cacheKey, { data: response, time: Date.now() });
      return res.status(200).json(response);
    } catch (e) {
      console.error("listings GET error:", e.message);
      return err(res, "Failed to fetch listings", 500);
    }
  }

  if (req.method === "POST") {
    const body = req.body;
    const required = ["name", "category", "description", "location", "phone"];
    const missing = required.filter((f) => !body[f]?.trim());
    if (missing.length) return err(res, "Missing fields: " + missing.join(", "));

    try {
      const data = await callAppsScript("createListing", {
        ownerEmail: body.ownerEmail || "",
        ownerName: body.ownerName || "",
        name: body.name.trim(),
        category: body.category.trim(),
        description: body.description.trim(),
        location: body.location.trim(),
        phone: body.phone.trim(),
        website: body.website?.trim() || "",
        logoUrl: body.logoUrl?.trim() || "",
        affiliateUrl: body.affiliateUrl?.trim() || "",
      }, "POST");

      // Clear listings cache when new listing is added
      cache.clear();
      return ok(res, { businessId: data.businessId }, 201);
    } catch (e) {
      console.error("listings POST error:", e.message);
      return err(res, "Failed to create listing", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};