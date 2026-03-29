import fs from "fs";
import path from "path";
import crypto from "crypto";

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Save image buffer to disk.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} dataDir - plugin data directory (ctx.dataDir)
 * @returns {Promise<{ filename: string, filePath: string }>}
 */
export async function saveImage(buffer, mimeType, dataDir) {
  const ext = MIME_TO_EXT[mimeType] || "png";
  const hash = crypto.createHash("md5").update(buffer).digest("hex").slice(0, 8);
  const filename = `${Date.now()}-${hash}.${ext}`;
  const dir = path.join(dataDir, "generated");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return { filename, filePath };
}
