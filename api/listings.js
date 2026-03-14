// api/listings.js
const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const { id, category, search, page = "1", limit = "12" } = req.query;

    try {
      const data = await callAppsScript("getListings", {
        id: id || "",
        category: category || "",
        search: search || "",
        page,
        limit,
      });

      return ok(res, {
        businesses: data.businesses || [],
        total: data.total || 0,
        page: Number(page),
        totalPages: data.totalPages || 1,
      });
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

      return ok(res, { businessId: data.businessId }, 201);
    } catch (e) {
      console.error("listings POST error:", e.message);
      return err(res, "Failed to create listing", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};
