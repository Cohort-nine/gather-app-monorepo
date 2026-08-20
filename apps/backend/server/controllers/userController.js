// ---------------------------------------------------------------------------
// User profile actions that aren't part of authentication itself.
//
// POST   /api/me/avatar   upload/replace the signed-in user's avatar
// DELETE /api/me/avatar   clear it back to null
//
// Both return the same publicUser() shape authController.js uses everywhere
// else, so the frontend doesn't need a different user shape depending on
// which endpoint it called.
// ---------------------------------------------------------------------------

import prisma from "../db/prisma.js";
import { publicUser } from "./authController.js";
import { deleteUploadedImage, publicUploadUrl, saveUploadedImage } from "../lib/upload.js";

/** POST /api/me/avatar — multipart/form-data, field name "avatar". */
export async function uploadAvatar(req, res, next) {
  if (!req.file) {
    return res.status(400).json({
      message: "Validation failed",
      errors: ["avatar file is required"]
    });
  }

  try {
    const filename = await saveUploadedImage(req.file);
    const url = publicUploadUrl(filename);

    const previous = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { avatarUrl: true }
    });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: url }
    });

    // Best-effort cleanup — an orphaned file costs disk space, not
    // correctness, so a failure here shouldn't fail the request.
    if (previous?.avatarUrl) await deleteUploadedImage(previous.avatarUrl);

    res.json({ message: "Avatar updated successfully", data: publicUser(user) });
  } catch (error) {
    if (error.isUploadValidation) {
      return res.status(400).json({ message: error.message, errors: [error.message] });
    }
    next(error);
  }
}

/** DELETE /api/me/avatar — resets avatarUrl to null. */
export async function deleteAvatar(req, res, next) {
  try {
    const previous = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { avatarUrl: true }
    });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: null }
    });

    if (previous?.avatarUrl) await deleteUploadedImage(previous.avatarUrl);

    res.json({ message: "Avatar removed successfully", data: publicUser(user) });
  } catch (error) {
    next(error);
  }
}
