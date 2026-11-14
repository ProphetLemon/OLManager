import { describe, expect, it } from "vitest";
import { parseTransferError } from "./saveTransfer";

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
