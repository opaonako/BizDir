// api/listing.js
// PUT  /api/listing  — update existing listing
// DELETE /api/listing — delete listing

const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {

  if (req.method === "PUT") {
    const body = req.body;
    if (!body.id) return err(res, "Business ID is required");

    const required = ["name","category","description","location","phone"];
    const missing = required.filter(f => !body[f]?.trim());
    if (missing.length) return err(res, "Missing fields: " + missing.join(", "));

    try {
      await callAppsScript("updateListing", {
        id:           body.id,
        name:         body.name.trim(),
        category:     body.category.trim(),
        description:  body.description.trim(),
        location:     body.location.trim(),
        phone:        body.phone.trim(),
        website:      body.website?.trim() || "",
        logoUrl:      body.logoUrl?.trim() || "",
        affiliateUrl: body.affiliateUrl?.trim() || "",
      }, "POST");

      return ok(res, { message: "Listing updated" });
    } catch (e) {
      console.error("listing PUT error:", e.message);
      return err(res, "Failed to update listing", 500);
    }
  }

  if (req.method === "DELETE") {
    const { id } = req.body;
    if (!id) return err(res, "Business ID is required");

    try {
      await callAppsScript("deleteListing", { id }, "POST");
      return ok(res, { message: "Listing deleted" });
    } catch (e) {
      console.error("listing DELETE error:", e.message);
      return err(res, "Failed to delete listing", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};