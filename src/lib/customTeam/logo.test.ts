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
} from "./logo";

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

describe("rasterizeToPngDataUri", () => {
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
    await expect(rasterizeToPngDataUri(new Blob(["x"], { type: "image/png" }))).resolves.toBe(PNG_URI);

    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(128);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 128);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/png");
    expect(close).toHaveBeenCalled();
  });

  it("reports unreadable when the browser cannot decode the file", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode")));

    expect(await rejection(rasterizeToPngDataUri(new Blob(["x"])))).toMatchObject({ code: "unreadable" });
  });

  it("reports unreadable when the canvas does not export a PNG", async () => {
    canvas.toDataURL.mockReturnValue("data:,");

    expect(await rejection(rasterizeToPngDataUri(new Blob(["x"])))).toMatchObject({ code: "unreadable" });
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
