// api/leads.js
// GET  /api/leads         - get all leads from Sheets
// POST /api/leads         - add a new lead  ✅ checks for duplicates first
// PUT  /api/leads         - update lead status

const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {

  // ── GET ──────────────────────────────────────────────────
  if (req.method === "GET") {
    const { status } = req.query;
    try {
      const data = await callAppsScript("getLeads", { status: status || "" });
      return ok(res, { leads: data.leads || [] });
    } catch(e) {
      return err(res, "Failed to fetch leads", 500);
    }
  }

  // ── POST ─────────────────────────────────────────────────
  if (req.method === "POST") {
    const { phone, businessName, address, category, website, source, placeId } = req.body;
    if (!phone) return err(res, "Phone is required");

    try {
      // ── DUPLICATE CHECK ──────────────────────────────────
      // Wrapped in its own try/catch so if this fails for any
      // reason it never blocks the actual lead creation.
      try {
        const existing = await callAppsScript("getLeads", {});
        const leads = existing.leads || [];
        const normalize = p => String(p).replace(/\D/g, "");

        const isDuplicate = leads.some(lead => {
          // 1. PlaceId match — strongest signal (LeadHunter leads)
          if (placeId && lead.placeId && lead.placeId === placeId) return true;
          // 2. Phone number match — digits only, ignores formatting
          if (normalize(lead.phone) === normalize(phone)) return true;
          return false;
        });

        if (isDuplicate) {
          // Return 200 not an error — caller knows it already exists
          return ok(res, { skipped: true, message: "Lead already exists" });
        }
      } catch (dupCheckErr) {
        // Duplicate check failed — log and proceed rather than blocking
        console.error("Duplicate check failed, proceeding:", dupCheckErr.message);
      }
      // ── END DUPLICATE CHECK ──────────────────────────────

      const data = await callAppsScript("createLead", {
        phone,
        businessName,
        address,
        category,
        website: website || "",
        source:  source  || "manual",
        placeId: placeId || "",
      });

      return ok(res, { leadId: data.leadId }, 201);

    } catch(e) {
      return err(res, "Failed to create lead", 500);
    }
  }

  // ── PUT ──────────────────────────────────────────────────
  if (req.method === "PUT") {
    const { id, status, transcript } = req.body;
    if (!id) return err(res, "Lead ID is required");
    try {
      await callAppsScript("updateLeadStatus", { id, status, transcript: transcript || "" });
      return ok(res, { message: "Lead updated" });
    } catch(e) {
      return err(res, "Failed to update lead", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};