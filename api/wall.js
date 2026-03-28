const { callAppsScript, ok, err } = require("./_utils");

const ADMIN_EMAIL = "paolollenado@gmail.com";

async function getViewerFromToken(token) {
  if (!token) throw new Error("Token is required");
  const viewer = await callAppsScript("validateToken", { token }, "POST");
  if (!viewer?.email) throw new Error("Invalid session");
  return viewer;
}

async function getOwnerBusiness(email) {
  const data = await callAppsScript("getListings", {
    ownerEmail: email,
    page: "1",
    limit: "1",
  }, "GET");

  const businesses = data.businesses || [];
  return businesses[0] || null;
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const { businessId } = req.query;
    if (!businessId) return err(res, "Business ID is required");

    try {
      const data = await callAppsScript("getWallPosts", { businessId }, "GET");
      return ok(res, { posts: data.posts || [] });
    } catch (e) {
      console.error("wall GET error:", e.message);
      return err(res, "Failed to load wall posts", 500);
    }
  }

  if (req.method === "POST") {
    const { token, businessId, message, parentId } = req.body || {};
    if (!businessId) return err(res, "Business ID is required");
    if (!message?.trim()) return err(res, "Message is required");

    try {
      const viewer = await getViewerFromToken(token);
      const ownerBusiness = await getOwnerBusiness(viewer.email);
      if (!ownerBusiness) return err(res, "Only listed business owners can post here", 403);

      const data = await callAppsScript("createWallPost", {
        businessId,
        message: message.trim(),
        authorEmail: viewer.email,
        authorName: viewer.name || "",
        authorBusinessId: ownerBusiness.id || "",
        authorBusinessName: ownerBusiness.name || "",
        parentId: parentId || "",
      }, "POST");

      return ok(res, { post: data.post || null }, 201);
    } catch (e) {
      console.error("wall POST error:", e.message);
      return err(res, e.message || "Failed to create wall post", 500);
    }
  }

  if (req.method === "DELETE") {
    const { token, postId } = req.body || {};
    if (!postId) return err(res, "Post ID is required");

    try {
      const viewer = await getViewerFromToken(token);
      await callAppsScript("deleteWallPost", {
        postId,
        requesterEmail: viewer.email,
        isAdmin: String(viewer.email === ADMIN_EMAIL),
      }, "POST");
      return ok(res, { deleted: true });
    } catch (e) {
      console.error("wall DELETE error:", e.message);
      return err(res, e.message || "Failed to delete wall post", 500);
    }
  }

  return err(res, "Method not allowed", 405);
};
