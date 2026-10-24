// Files people upload on team assignments (signed copies, supporting papers). Server-only.
// Kept on disk under FILES_DIR (on the VM a Docker volume, backed up by deploy/backup.sh), named
// by their id; the database (team_files) holds the name, type, size and checksum.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { query } from "./db";
import { HttpError } from "./auth";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// PDFs, images, Word and Excel: what a signed copy, a quotation or a legal note comes as
const TYPES = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};
// the file's first bytes must agree with its type
const MAGIC = { ".pdf": "%PDF", ".png": "\x89PNG", ".jpg": "\xff\xd8\xff", ".docx": "PK\x03\x04", ".xlsx": "PK\x03\x04" };

export function filesDir() {
  // turbopackIgnore: a runtime folder, not a source file for the bundler to trace
  return process.env.FILES_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data", "files");
}

/** Store an uploaded File (from formData) and record it; returns { id, name, size }. */
export async function saveUpload(file, memberId) {
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "No file.");
  const ext = TYPES[file.type];
  if (!ext) throw new HttpError(400, "Upload a PDF, PNG, JPEG, Word or Excel file.");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "The file is larger than 25 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, MAGIC[ext].length).toString("latin1") !== MAGIC[ext]) throw new HttpError(400, "The file's contents do not match its type.");
  const name = String(file.name || `upload${ext}`).replace(/[\\/\0]/g, "_").slice(0, 200);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const dir = filesDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const id = crypto.randomUUID();
  const rel = `${id}${ext}`;
  await fs.writeFile(path.join(/* turbopackIgnore: true */ dir, rel), buf, { mode: 0o600 });
  await query("INSERT INTO team_files (id, name, content_type, size_bytes, sha256, path, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, name, file.type, buf.length, sha256, rel, memberId]);
  return { id, name, size: buf.length };
}

export async function readStored(row) {
  // the stored path is our own id and extension, never a client path
  if (!/^[0-9a-f-]{36}\.[a-z]{3,4}$/.test(row.path)) throw new HttpError(404, "File not found.");
  try {
    return await fs.readFile(path.join(/* turbopackIgnore: true */ filesDir(), row.path));
  } catch {
    throw new HttpError(404, "The file is missing on the server.");
  }
}
