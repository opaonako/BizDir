// api/leads.js
// GET  /api/leads         - get all leads from Sheets
// POST /api/leads         - add a new lead
// PUT  /api/leads         - update lead status

const { callAppsScript, ok, err } = require("./_utils");

module.exports = async (req, res) => {

  if (req.method === "GET") {
    const { status } = req.query;
    try {
      const data = await callAppsScript("getLeads", { status: status || "" });
      return ok(res, { leads: data.leads || [] });
    } catch(e) {
      return err(res, "Failed to fetch leads", 500);
    }
  }

  if (req.method === "POST") {
    const { phone, businessName, address, category, website, source } = req.body;
    if (!phone) return err(res, "Phone is required");
    try {
      const data = await callAppsScript("createLead", {
        phone, businessName, address, category,
        website: website || "", source: source || "manual",
      }, "POST");
      return ok(res, { leadId: data.leadId }, 201);
    } catch(e) {
      return err(res, "Failed to create lead", 500);
    }
  }

  if (req.method === "PUT") {
    const { id, status, transcript } = req.body;
    if (!id) return err(res, "Lead ID is required");
    try {
      await callAppsScript("updateLeadStatus", { id, status, transcript: transcript || "" }, "POST");
      return ok(res, { message: "Lead updated" });
    } catch(e) {
      return err(res, "Failed to update lead", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};