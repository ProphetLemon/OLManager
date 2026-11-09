import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  LOGO_MAX_FILE_BYTES,
  LogoUploadError,
  buildLogoFromFile,
  checkLogoFile,
  fitLogoSize,
  parseLogoError,
  prepareCustomLogo,
  rasterizeToPngDataUri,
  readImageDimensions,
} from "./logo";

/** Header-only fixtures: just enough bytes for the dimension parser. */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}
function jpegHeader(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0 (length 17).
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
  b.set([0xff, 0xc0, 0, 17, 8], 20);
  new DataView(b.buffer).setUint16(25, height);
  new DataView(b.buffer).setUint16(27, width);
  return b;
}
function webpHeader(kind: "VP8X" | "VP8L" | "VP8 ", width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([...("RIFF" as string)].map((c) => c.charCodeAt(0)), 0);
  b.set([...("WEBP" + kind)].map((c) => c.charCodeAt(0)), 8);
  if (kind === "VP8X") {
    const w = width - 1;
    const h = height - 1;
    b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24);
  } else if (kind === "VP8L") {
    const bits = ((width - 1) | ((height - 1) << 14)) >>> 0;
    b.set([0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255], 20);
  } else {
    b.set([0x9d, 0x01, 0x2a, width & 255, width >> 8, height & 255, height >> 8], 23);
  }
  return b;
}

/** The error a promise rejects with, or fails the test when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

const PNG_URI = "data:image/png;base64,iVBORw0KGgo=";

describe("checkLogoFile", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s", (type) => {
    expect(checkLogoFile({ type, size: 1000 })).toBeNull();
  });

  it.each(["image/svg+xml", "image/gif", "application/pdf", ""])("rejects %j", (type) => {
    expect(checkLogoFile({ type, size: 1000 })).toBe("unsupportedType");
  });

  it("accepts a file of exactly the limit and rejects one byte more", () => {
    expect(checkLogoFile({ type: "image/png", size: LOGO_MAX_FILE_BYTES })).toBeNull();
    expect(checkLogoFile({ type: "image/png", size: LOGO_MAX_FILE_BYTES + 1 })).toBe("fileTooLarge");
  });

  it("reports the type before the size", () => {
    expect(checkLogoFile({ type: "image/svg+xml", size: LOGO_MAX_FILE_BYTES + 1 })).toBe("unsupportedType");
  });
});

describe("fitLogoSize", () => {
  it("keeps images that already fit", () => {
    expect(fitLogoSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(fitLogoSize(256, 256)).toEqual({ width: 256, height: 256 });
  });

  it("scales the longest side to 256 keeping the aspect ratio", () => {
    expect(fitLogoSize(1024, 512)).toEqual({ width: 256, height: 128 });
    expect(fitLogoSize(300, 600)).toEqual({ width: 128, height: 256 });
    expect(fitLogoSize(4000, 4000)).toEqual({ width: 256, height: 256 });
  });

  it("never returns a zero side", () => {
    expect(fitLogoSize(4000, 1)).toEqual({ width: 256, height: 1 });
    expect(fitLogoSize(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it("never upscales", () => {
    expect(fitLogoSize(10, 20)).toEqual({ width: 10, height: 20 });
  });
});

describe("parseLogoError", () => {
  it.each([
    ["empty", "invalid"],
    ["not_png", "invalid"],
    ["malformed", "invalid"],
    ["too_large", "tooBig"],
    ["too_big_dimensions", "tooBig"],
  ] as const)("maps the wire reason %s", (reason, code) => {
    expect(parseLogoError(JSON.stringify({ kind: "invalid_logo", reason }))).toBe(code);
  });

  it("maps the plain text select_team returns", () => {
    expect(parseLogoError("Invalid club logo: too_large")).toBe("tooBig");
    expect(parseLogoError(new Error("Invalid club logo: not_png"))).toBe("invalid");
  });

  it("falls back to a generic failure", () => {
    expect(parseLogoError("boom")).toBe("failed");
    expect(parseLogoError(undefined)).toBe("failed");
    expect(parseLogoError("{not json")).toBe("failed");
    expect(parseLogoError(JSON.stringify({ kind: "other" }))).toBe("failed");
    expect(parseLogoError(JSON.stringify({ kind: "invalid_logo", reason: "future" }))).toBe("failed");
  });
});

describe("prepareCustomLogo", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("sends the PNG as dataUri and returns the normalized string", async () => {
    invokeMock.mockResolvedValue("data:image/png;base64,NORMALIZED");

    await expect(prepareCustomLogo(PNG_URI)).resolves.toBe("data:image/png;base64,NORMALIZED");
    expect(invokeMock).toHaveBeenCalledWith("prepare_custom_logo", { dataUri: PNG_URI });
  });

  it("turns a backend rejection into a LogoUploadError", async () => {
    // Tauri rejects with the command's plain error string.
    invokeMock.mockRejectedValue('{"kind":"invalid_logo","reason":"too_large"}');

    const error = await rejection(prepareCustomLogo(PNG_URI));

    expect(error).toBeInstanceOf(LogoUploadError);
    expect((error as LogoUploadError).code).toBe("tooBig");
  });
});

describe("readImageDimensions", () => {
  it("reads PNG, JPEG and the three WebP flavours", () => {
    expect(readImageDimensions(pngHeader(30000, 20))).toEqual({ width: 30000, height: 20 });
    expect(readImageDimensions(jpegHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(readImageDimensions(webpHeader("VP8X", 12000, 40))).toEqual({ width: 12000, height: 40 });
    expect(readImageDimensions(webpHeader("VP8L", 300, 200))).toEqual({ width: 300, height: 200 });
    expect(readImageDimensions(webpHeader("VP8 ", 64, 32))).toEqual({ width: 64, height: 32 });
  });

  it("returns null for anything it cannot parse", () => {
    expect(readImageDimensions(new Uint8Array())).toBeNull();
    expect(readImageDimensions(new TextEncoder().encode("<svg/>"))).toBeNull();
    expect(readImageDimensions(pngHeader(1, 1).slice(0, 20))).toBeNull();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
  });
});

describe("rasterizeToPngDataUri", () => {
  const validPng = () => new Blob([pngHeader(1024, 512)], { type: "image/png" });

  const drawImage = vi.fn();
  const close = vi.fn();
  let canvas: { width: number; height: number; getContext: () => unknown; toDataURL: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    drawImage.mockReset();
    close.mockReset();
    canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: vi.fn(() => PNG_URI),
    };
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "canvas" ? canvas : document.createElementNS("http://www.w3.org/1999/xhtml", tag)) as never);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1024, height: 512, close })),
    );
  });

  it("draws the image fitted into 256x256 and exports a PNG", async () => {
    await expect(rasterizeToPngDataUri(validPng())).resolves.toBe(PNG_URI);

    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(128);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 128);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
    expect(close).toHaveBeenCalled();
  });

  it("reports unreadable when the browser cannot decode the file", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode")));

    expect(await rejection(rasterizeToPngDataUri(validPng()))).toMatchObject({ code: "unreadable" });
  });

  it("refuses a small file that declares a huge canvas before decoding it", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    expect(await rejection(rasterizeToPngDataUri(new Blob([pngHeader(30000, 30000)])))).toMatchObject({ code: "tooBig" });
    expect(await rejection(rasterizeToPngDataUri(new Blob([jpegHeader(4097, 10)])))).toMatchObject({ code: "tooBig" });
    expect(decode).not.toHaveBeenCalled();
  });

  it("accepts the largest allowed side", async () => {
    await expect(rasterizeToPngDataUri(new Blob([pngHeader(4096, 4096)]))).resolves.toBe(PNG_URI);
  });

  it("refuses a header it cannot parse without decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    expect(await rejection(rasterizeToPngDataUri(new Blob(["x"])))).toMatchObject({ code: "unreadable" });
    expect(decode).not.toHaveBeenCalled();
  });

  it("reports unreadable when the canvas does not export a PNG", async () => {
    canvas.toDataURL.mockReturnValue("data:,");

    expect(await rejection(rasterizeToPngDataUri(validPng()))).toMatchObject({ code: "unreadable" });
    expect(close).toHaveBeenCalled();
  });
});

describe("buildLogoFromFile", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.restoreAllMocks();
  });

  it("rejects an SVG before decoding anything", async () => {
    const bitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", bitmap);
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });

    await expect(buildLogoFromFile(file)).rejects.toBeInstanceOf(LogoUploadError);
    expect(bitmap).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
