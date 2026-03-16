// api/listing.js
// PUT    /api/listing  — update existing listing or just its status
// DELETE /api/listing  — delete listing

const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {

  if (req.method === "PUT") {
    const body = req.body;
    if (!body.id) return err(res, "Business ID is required");

    // ── STATUS-ONLY UPDATE (admin approve/reject) ────────────
    // If only id + status are passed, just update the status.
    // No field validation needed — we're not editing the listing.
    if (body.status && !body.name) {
      try {
        await callAppsScript("updateListing", {
          id:     body.id,
          status: body.status,
        }, "POST");
        return ok(res, { message: "Status updated" });
      } catch (e) {
        console.error("listing status update error:", e.message);
        return err(res, "Failed to update status", 500);
      }
    }

    // ── FULL LISTING EDIT ────────────────────────────────────
    // All fields required when editing listing details.
    const required = ["name", "category", "description", "location", "phone"];
    const missing  = required.filter(f => !body[f]?.trim());
    if (missing.length) return err(res, "Missing fields: " + missing.join(", "));

    try {
      await callAppsScript("updateListing", {
        id:           body.id,
        name:         body.name.trim(),
        category:     body.category.trim(),
        description:  body.description.trim(),
        location:     body.location.trim(),
        phone:        body.phone.trim(),
        website:      body.website?.trim()      || "",
        logoUrl:      body.logoUrl?.trim()      || "",
        affiliateUrl: body.affiliateUrl?.trim() || "",
        status:       body.status               || "",
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