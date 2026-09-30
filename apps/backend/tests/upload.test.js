import { beforeEach, describe, expect, it, vi } from "vitest";

// Images are stored as rows now, so the only thing to mock is the Prisma
// client — nothing here touches a real database.
const prismaMock = {
  storedImage: {
    create: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn()
  }
};

vi.mock("../server/db/prisma.js", () => ({ default: prismaMock }));

const { deleteUploadedImage, imageIdFromUrl, saveUploadedImage, serveUploadedImage } =
  await import("../server/lib/upload.js");

const IMAGE_ID = "66666666-6666-4666-8666-666666666666";

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.set = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.storedImage.create.mockResolvedValue({ id: IMAGE_ID });
  prismaMock.storedImage.delete.mockResolvedValue({});
});

describe("saveUploadedImage", () => {
  it("accepts a real PNG signature and stores it under a generated id, ignoring the client's own name", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

    const filename = await saveUploadedImage({
      buffer: pngBytes,
      mimetype: "image/png",
      originalname: "../../etc/passwd.png"
    });

    // id.ext, nothing borrowed from originalname.
    expect(filename).toBe(`${IMAGE_ID}.png`);
    expect(prismaMock.storedImage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mimeType: "image/png", byteSize: pngBytes.length })
      })
    );
  });

  it("rejects a file whose bytes don't match an allowed image signature, even with a spoofed Content-Type", async () => {
    const notAnImage = Buffer.from("<html><body>definitely not an image</body></html>");

    await expect(
      saveUploadedImage({ buffer: notAnImage, mimetype: "image/png" })
    ).rejects.toMatchObject({ isUploadValidation: true });

    expect(prismaMock.storedImage.create).not.toHaveBeenCalled();
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

describe("imageIdFromUrl", () => {
  it("extracts the id from a stored upload path", () => {
    expect(imageIdFromUrl(`/uploads/${IMAGE_ID}.jpg`)).toBe(IMAGE_ID);
  });

  it("ignores external URLs and traversal attempts", () => {
    expect(imageIdFromUrl("https://i.pravatar.cc/160?u=maya")).toBeNull();
    expect(imageIdFromUrl("/uploads/../../etc/passwd")).toBeNull();
    expect(imageIdFromUrl(null)).toBeNull();
  });
});

describe("deleteUploadedImage", () => {
  it("deletes only the row named by a valid stored path", async () => {
    await deleteUploadedImage(`/uploads/${IMAGE_ID}.png`);
    expect(prismaMock.storedImage.delete).toHaveBeenCalledWith({ where: { id: IMAGE_ID } });
  });

  it("is a no-op for an external URL or a falsy value", async () => {
    await deleteUploadedImage("https://picsum.photos/seed/x/800/450");
    await deleteUploadedImage(null);
    expect(prismaMock.storedImage.delete).not.toHaveBeenCalled();
  });

  it("never throws when the row is already gone", async () => {
    prismaMock.storedImage.delete.mockRejectedValue(new Error("Record not found"));
    await expect(deleteUploadedImage(`/uploads/${IMAGE_ID}.png`)).resolves.toBeUndefined();
  });
});

describe("serveUploadedImage", () => {
  it("sends the stored bytes with their type and a long cache lifetime", async () => {
    prismaMock.storedImage.findUnique.mockResolvedValue({
      mimeType: "image/png",
      data: Buffer.from([1, 2, 3])
    });
    const res = mockRes();

    await serveUploadedImage({ params: { filename: `${IMAGE_ID}.png` } }, res, vi.fn());

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ "Content-Type": "image/png" })
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });

  it("404s for an unknown or malformed name without querying", async () => {
    const res = mockRes();
    await serveUploadedImage({ params: { filename: "nope.png" } }, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prismaMock.storedImage.findUnique).not.toHaveBeenCalled();
  });
});
