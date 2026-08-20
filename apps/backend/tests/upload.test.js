import { beforeEach, describe, expect, it, vi } from "vitest";

// saveUploadedImage writes with node:fs/promises -- mock just that so tests
// don't leave real files behind in server/uploads.
const writeFileMock = vi.fn().mockResolvedValue(undefined);
const unlinkMock = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  writeFile: (...args) => writeFileMock(...args),
  unlink: (...args) => unlinkMock(...args)
}));

const { deleteUploadedImage, saveUploadedImage } = await import("../server/lib/upload.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveUploadedImage", () => {
  it("accepts a real PNG signature and stores it under a generated filename, ignoring the client's own name", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

    const filename = await saveUploadedImage({
      buffer: pngBytes,
      mimetype: "image/png",
      originalname: "../../etc/passwd.png"
    });

    // uuid.ext, nothing borrowed from originalname.
    expect(filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a file whose bytes don't match an allowed image signature, even with a spoofed Content-Type", async () => {
    const notAnImage = Buffer.from("<html><body>definitely not an image</body></html>");

    await expect(
      saveUploadedImage({ buffer: notAnImage, mimetype: "image/png" })
    ).rejects.toMatchObject({ isUploadValidation: true });

    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    await expect(
      saveUploadedImage({ buffer: Buffer.alloc(0), mimetype: "image/jpeg" })
    ).rejects.toMatchObject({ isUploadValidation: true });
  });

  it("recognizes a WEBP RIFF container", async () => {
    const webpBytes = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
      Buffer.from([0, 0, 0, 0]), // chunk size, irrelevant here
      Buffer.from("WEBP", "ascii")
    ]);

    const filename = await saveUploadedImage({ buffer: webpBytes, mimetype: "image/webp" });
    expect(filename).toMatch(/\.webp$/);
  });
});

describe("deleteUploadedImage", () => {
  it("only ever deletes a bare filename inside UPLOAD_DIR, never a path built from input", async () => {
    await deleteUploadedImage("/uploads/../../etc/passwd");

    expect(unlinkMock).toHaveBeenCalledTimes(1);
    const [deletedPath] = unlinkMock.mock.calls[0];
    expect(deletedPath.endsWith("passwd")).toBe(true);
    expect(deletedPath).not.toMatch(/\.\./);
  });

  it("is a no-op for a falsy filename", async () => {
    await deleteUploadedImage(null);
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});
