// ---------------------------------------------------------------------------
// Image upload — shared by the avatar and event-cover-image endpoints.
//
// Files are held in memory just long enough to be sniffed and written to disk
// under a name generated here, never the client's. The client's filename and
// declared Content-Type are only used for an early, cheap rejection —
// both are trivial to fake, so the real gate is the magic-byte check in
// saveUploadedImage(), which looks at the actual bytes before anything is
// written to UPLOAD_DIR.
//
// This is a type/size gate only, not content moderation — screening what's
// actually IN the image would mean a third-party API, which is out of scope
// here.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(HERE, "../../uploads");

// Created synchronously at import time, same as everything else that depends
// on this directory existing — there's no request path that should be first
// to discover it's missing.
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Magic-byte signatures for the three formats accepted. Checked against the
// actual file bytes in saveUploadedImage(), after multer's fileFilter has
// already done the cheap Content-Type check. A client can set
// "Content-Type: image/png" on an .exe as easily as it can rename the file,
// so the header bytes are the only thing worth trusting.
const SIGNATURES = [
  { mime: "image/jpeg", ext: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", ext: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WEBP is a RIFF container: bytes 0-3 are "RIFF", bytes 8-11 are "WEBP".
  { mime: "image/webp", ext: "webp", bytes: [0x52, 0x49, 0x46, 0x46], riff: true }
];

function sniffImageType(buffer) {
  for (const sig of SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    if (!sig.bytes.every((b, i) => buffer[i] === b)) continue;
    if (sig.riff && buffer.subarray(8, 12).toString("ascii") !== "WEBP") continue;
    return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}

/** Marks an Error as a client-caused upload problem, not a server failure. */
function uploadError(message) {
  const err = new Error(message);
  err.isUploadValidation = true;
  return err;
}

// Held in memory rather than written straight to disk, so the magic bytes can
// be checked before anything lands in UPLOAD_DIR under a name an attacker
// chose.
const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(uploadError(
      `Unsupported file type: ${file.mimetype}. Only JPEG, PNG, and WEBP images are allowed.`
    ));
  }
  cb(null, true);
}

/** multer middleware — mount as `imageUpload.single("<fieldName>")`. */
export const imageUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 }
});

/**
 * Verify the uploaded buffer really is one of the allowed image types (by
 * content, not by the Content-Type header fileFilter already checked) and
 * write it to UPLOAD_DIR under a name generated here — crypto.randomUUID()
 * plus the extension implied by the sniffed type, never the client's
 * filename. Returns the stored filename.
 *
 * Throws an Error with `.isUploadValidation = true` on a bad file — callers
 * turn that into this codebase's normal { message, errors } envelope, the
 * same as any other validation failure.
 */
export async function saveUploadedImage(file) {
  if (!file?.buffer?.length) {
    throw uploadError("Uploaded file was empty.");
  }

  const detected = sniffImageType(file.buffer);
  if (!detected) {
    throw uploadError("That file doesn't look like a JPEG, PNG, or WEBP image.");
  }

  const filename = `${crypto.randomUUID()}.${detected.ext}`;
  await writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
  return filename;
}

/** The public, static-served path for a stored filename. */
export const publicUploadUrl = (filename) => `/uploads/${filename}`;

/**
 * Best-effort delete of a previously-uploaded image, given either a stored
 * filename or a full "/uploads/xxx" URL. Only ever deletes a bare filename
 * inside UPLOAD_DIR — never a path built from user input — and never throws:
 * a stale file left behind costs disk space, not correctness, so cleanup
 * failing shouldn't fail the request that triggered it.
 */
export async function deleteUploadedImage(urlOrFilename) {
  if (!urlOrFilename) return;
  const base = path.basename(urlOrFilename);
  await unlink(path.join(UPLOAD_DIR, base)).catch(() => {});
}
