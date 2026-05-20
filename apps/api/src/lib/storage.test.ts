import { describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: vi.fn().mockImplementation(function (args: unknown) { return { args, type: "GET" }; }),
  PutObjectCommand: vi.fn().mockImplementation(function (args: unknown) { return { args, type: "PUT" }; }),
  S3Client: vi.fn().mockImplementation(function () { return { send: sendMock }; }),
}));

// vi.mock must precede import of module under test
import { assetKey, fetchAsset, uploadAsset } from "./storage";

describe("assetKey", () => {
  it("builds a deterministic per-org key from sha256 + ext", () => {
    expect(assetKey("org_1", "abc123", "jpg")).toBe("org_org_1/abc123.jpg");
  });

  it("strips a leading dot from the extension", () => {
    expect(assetKey("org_1", "abc123", ".png")).toBe("org_org_1/abc123.png");
  });
});

describe("uploadAsset", () => {
  it("sends a PutObjectCommand with bucket, key, body, content-type", async () => {
    sendMock.mockResolvedValue({});
    const bytes = new Uint8Array([1, 2, 3]);

    await uploadAsset({ bytes, key: "org_1/abc.jpg", mimeType: "image/jpeg" });

    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = sendMock.mock.calls[0]![0] as { args: { Body: Uint8Array; Bucket: string; ContentType: string; Key: string }; type: string };
    expect(cmd.type).toBe("PUT");
    expect(cmd.args.Bucket).toBe("test-bucket");
    expect(cmd.args.Key).toBe("org_1/abc.jpg");
    expect(cmd.args.Body).toBe(bytes);
    expect(cmd.args.ContentType).toBe("image/jpeg");
  });
});

describe("fetchAsset", () => {
  it("returns the bytes from a GetObjectCommand response", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    sendMock.mockResolvedValue({
      Body: { transformToByteArray: () => Promise.resolve(bytes) },
    });

    const result = await fetchAsset("org_1/abc.jpg");

    const cmd = sendMock.mock.calls.at(-1)![0] as { args: { Bucket: string; Key: string }; type: string };
    expect(cmd.type).toBe("GET");
    expect(cmd.args.Bucket).toBe("test-bucket");
    expect(cmd.args.Key).toBe("org_1/abc.jpg");
    expect(result).toBe(bytes);
  });
});
