// plugins/image-gen/routes/media.js
import fs from "fs";
import path from "path";

export default function (app, ctx) {
  // Serve generated images
  app.get("/media/:filename", async (c) => {
    const filename = c.req.param("filename");
    // Security: reject path traversal
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return c.json({ error: "invalid filename" }, 400);
    }
    const filePath = path.join(ctx.dataDir, "generated", filename);
    if (!fs.existsSync(filePath)) {
      return c.json({ error: "not found" }, 404);
    }
    const ext = path.extname(filename).slice(1);
    const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
    const mime = mimeMap[ext] || "application/octet-stream";
    const buf = fs.readFileSync(filePath);
    return new Response(buf, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  // Provider summary for Media settings tab
  app.get("/providers", async (c) => {
    try {
      const { models } = await ctx.bus.request("provider:models-by-type", { type: "image" });
      // Group by provider, check credentials
      const grouped = {};
      for (const m of (models || [])) {
        if (!grouped[m.provider]) {
          const creds = await ctx.bus.request("provider:credentials", { providerId: m.provider });
          grouped[m.provider] = {
            providerId: m.provider,
            hasCredentials: !creds.error,
            models: [],
          };
        }
        grouped[m.provider].models.push({ id: m.id, name: m.name });
      }
      return c.json({ providers: grouped, config: ctx.config.get() || {} });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Save plugin config (default model, provider defaults)
  app.put("/config", async (c) => {
    try {
      const body = await c.req.json();
      const current = ctx.config.get() || {};
      ctx.config.set(null, { ...current, ...body });
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });
}
