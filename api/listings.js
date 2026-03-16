const { callAppsScript, ok, err } = require("./_utils");

const cache = new Map();
const CACHE_TTL = 30 * 1000;

module.exports = async (req, res) => {
  if (req.method === "GET") {
    // ── Destructure status from query ──────────────────────
    const { id, category, search, page = "1", limit = "12", status } = req.query;

    // Single business lookup — bypass cache
    if (id) {
      try {
        const data = await callAppsScript("getListings", { id });
        return res.status(200).json({
          success: true,
          business: data.business || null,
        });
      } catch (e) {
        console.error("single listing error:", e.message);
        return err(res, "Business not found", 404);
      }
    }

    // Multiple listings with cache
    // ── status included in cache key so pending/approved/rejected
    //    never share the same cached response ──────────────────
    const cacheKey = `${status||""}_${category||""}_${search||""}_${page}_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.status(200).json(cached.data);
    }

    try {
      const data = await callAppsScript("getListings", {
        id: "",
        category: category || "",
        search:   search   || "",
        page,
        limit,
        status:   status   || "",  // ← pass status through to Apps Script
      });

      const response = {
        success:    true,
        businesses: data.businesses || [],
        total:      data.total      || 0,
        page:       Number(page),
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
        ownerEmail:   body.ownerEmail   || "",
        ownerName:    body.ownerName    || "",
        name:         body.name.trim(),
        category:     body.category.trim(),
        description:  body.description.trim(),
        location:     body.location.trim(),
        phone:        body.phone.trim(),
        website:      body.website?.trim()      || "",
        logoUrl:      body.logoUrl?.trim()      || "",
        affiliateUrl: body.affiliateUrl?.trim() || "",
      }, "POST");

      // Clear all cached listings when new listing is added
      cache.clear();
      return ok(res, { businessId: data.businessId }, 201);
    } catch (e) {
      console.error("listings POST error:", e.message);
      return err(res, "Failed to create listing", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};