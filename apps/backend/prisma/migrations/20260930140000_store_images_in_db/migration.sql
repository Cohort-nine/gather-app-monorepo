-- Uploaded images (avatars, event covers) move off the web server's disk and
-- into the database. Render's free tier has an ephemeral filesystem, so files
-- written to disk vanished on every redeploy and every idle spin-down. A row
-- here survives both. Images are capped at 5MB by the upload middleware, and
-- the CHECKs below repeat both rules so the database enforces them too.

-- CreateTable
CREATE TABLE "images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mime_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

ALTER TABLE images
    ADD CONSTRAINT images_mime_type_allowed
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE images
    ADD CONSTRAINT images_byte_size_sane
    CHECK (byte_size > 0 AND byte_size <= 5242880);
