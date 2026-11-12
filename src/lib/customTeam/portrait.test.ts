import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { LOGO_MAX_FILE_BYTES, LogoUploadError, parseLogoError, rasterizeToPngDataUri } from "./logo";
import { PORTRAIT_SIDE, buildPortraitFromFile, preparePortrait } from "./portrait";

const PNG_URI = "data:image/png;base64,AAAA";
const STORED = "data:image/png;base64,BBBB";

/** A PNG header that declares `width` x `height`, enough for the dimension check. */
function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

const picked = (size = 1024, type = "image/png") => {
  const file = new File([pngHeader(1000, 500)], "me.png", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

describe("the portrait pipeline", () => {
  const drawImage = vi.fn();
  let canvas: { width: number; height: number; getContext: () => unknown; toDataURL: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    invokeMock.mockReset();
    drawImage.mockReset();
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: vi.fn(() => PNG_URI) };
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "canvas" ? canvas : document.createElementNS("http://www.w3.org/1999/xhtml", tag)) as never);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1000, height: 500, close: vi.fn() })),
    );
  });

  it("draws the centred square of the picture, not the whole of it", async () => {
    await rasterizeToPngDataUri(picked(), { side: PORTRAIT_SIDE, square: true });

    expect(canvas.width).toBe(PORTRAIT_SIDE);
    expect(canvas.height).toBe(PORTRAIT_SIDE);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 250, 0, 500, 500, 0, 0, PORTRAIT_SIDE, PORTRAIT_SIDE);
  });

  it("still draws a badge whole when no target is given", async () => {
    await rasterizeToPngDataUri(picked());

    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(128);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 128);
  });

  it("sends the squared PNG to prepare_custom_portrait and resolves with what it answers", async () => {
    invokeMock.mockResolvedValue(STORED);

    await expect(buildPortraitFromFile(picked())).resolves.toBe(STORED);

    expect(invokeMock).toHaveBeenCalledWith("prepare_custom_portrait", { dataUri: PNG_URI });
  });

  it("crops the picked file to its centred square on the way to the backend", async () => {
    invokeMock.mockResolvedValue(STORED);

    await buildPortraitFromFile(picked());

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 250, 0, 500, 500, 0, 0, PORTRAIT_SIDE, PORTRAIT_SIDE);
  });

  it("refuses a file that is not PNG, JPEG or WebP without asking the backend", async () => {
    const error = await rejection(buildPortraitFromFile(picked(1024, "image/svg+xml")));

    expect(error).toMatchObject({ code: "unsupportedType" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses a file above the size limit without decoding it", async () => {
    const error = await rejection(buildPortraitFromFile(picked(LOGO_MAX_FILE_BYTES + 1)));

    expect(error).toMatchObject({ code: "fileTooLarge" });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("maps the backend's portrait rejections to the same codes as the badge", async () => {
    invokeMock.mockRejectedValue('{"kind":"invalid_portrait","reason":"too_large"}');

    const error = await rejection(preparePortrait(PNG_URI));

    expect(error).toBeInstanceOf(LogoUploadError);
    expect(error).toMatchObject({ code: "tooBig" });
  });

  it("understands both wire kinds and still treats anything else as a failure", () => {
    expect(parseLogoError('{"kind":"invalid_portrait","reason":"malformed"}')).toBe("invalid");
    expect(parseLogoError('{"kind":"invalid_logo","reason":"malformed"}')).toBe("invalid");
    expect(parseLogoError('{"kind":"something_else","reason":"malformed"}')).toBe("failed");
  });
});
