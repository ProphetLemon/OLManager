import { describe, expect, it } from "vitest";
import { parseLoadError, parseTransferError } from "./saveTransfer";

describe("parseTransferError", () => {
  it("reads the code before the pipe", () => {
    expect(parseTransferError("wrong_version|The file is from another game version")).toEqual({
      code: "wrong_version",
      message: "The file is from another game version",
    });
  });

  it("keeps a pipe inside the message", () => {
    expect(parseTransferError("corrupt|bad | data").message).toBe("bad | data");
  });

  it("treats an unrecognized prefix as unknown with the whole text", () => {
    expect(parseTransferError("nope|text")).toEqual({ code: "unknown", message: "nope|text" });
  });

  it("treats plain strings and errors as unknown", () => {
    expect(parseTransferError("Lock error").code).toBe("unknown");
    expect(parseTransferError(new Error("boom"))).toEqual({ code: "unknown", message: "boom" });
  });
});

describe("parseLoadError", () => {
  it("reads the format number out of a save_incompatible error", () => {
    expect(
      parseLoadError("save_incompatible: the save was written with format 4; this version reads 3"),
    ).toEqual({ kind: "incompatible", found: 4, message: "the save was written with format 4; this version reads 3" });
  });

  it("recognizes a save_unreadable error", () => {
    expect(parseLoadError("save_unreadable: Failed to read version")).toMatchObject({ kind: "unreadable" });
  });

  it("reads the code out of an Error as well as a string", () => {
    expect(parseLoadError(new Error("save_unreadable: x"))).toMatchObject({ kind: "unreadable" });
  });

  it("leaves any other error as unknown with its text", () => {
    expect(parseLoadError("Lock error: poisoned")).toEqual({ kind: "unknown", message: "Lock error: poisoned" });
  });

  it("does not take a code that only appears later in the text", () => {
    expect(parseLoadError("Failed: save_unreadable: x")).toMatchObject({ kind: "unknown" });
  });
});
