import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return {
    initReactI18next: { type: "3rdParty", init: vi.fn() },
    useTranslation: () => ({ i18n: { language: "en" }, t: translateFromEnglish }),
  };
});

const build = vi.hoisted(() => vi.fn());
vi.mock("@/lib/customTeam/logo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customTeam/logo")>()),
  buildLogoFromFile: build,
}));

import { LogoUploadError } from "@/lib/customTeam/logo";
import LogoUploadControl from "./LogoUploadControl";

const LOGO = "data:image/png;base64,AAAA";

function setup(props: Partial<React.ComponentProps<typeof LogoUploadControl>> = {}) {
  const onChange = vi.fn();
  const onInteract = vi.fn();
  const view = render(<LogoUploadControl value={null} onChange={onChange} onInteract={onInteract} {...props} />);
  return { onChange, onInteract, ...view };
}

function pick(file: File) {
  fireEvent.change(screen.getByTestId("logo-file-input"), { target: { files: [file] } });
}

const png = () => new File(["x"], "logo.png", { type: "image/png" });

describe("LogoUploadControl", () => {
  beforeEach(() => {
    build.mockReset();
  });

  it("offers a keyboard reachable upload button and no remove button without a logo", () => {
    setup();

    expect(screen.getByRole("button", { name: "Upload your badge" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Remove image" })).toBeNull();
    expect(screen.getByTestId("logo-file-input")).toHaveAttribute(
      "accept",
      expect.stringContaining("image/png"),
    );
    expect(screen.getByTestId("logo-file-input").getAttribute("accept")).not.toContain("svg");
  });

  it("opens the file picker from the button", () => {
    setup();
    const click = vi.spyOn(screen.getByTestId("logo-file-input"), "click");

    fireEvent.click(screen.getByRole("button", { name: "Upload your badge" }));

    expect(click).toHaveBeenCalled();
  });

  it("reports the normalized logo once the file is prepared", async () => {
    build.mockResolvedValue(LOGO);
    const { onChange } = setup();

    pick(png());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(LOGO));
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ name: "logo.png" }));
  });

  it("announces progress while the file is being prepared", async () => {
    let finish: (value: string) => void = () => undefined;
    build.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    setup();

    pick(png());

    expect(await screen.findByText("Preparing your badge...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload your badge" })).toBeDisabled();
    finish(LOGO);
    await waitFor(() => expect(screen.queryByText("Preparing your badge...")).toBeNull());
  });

  it("shows a preview with object-contain and the remove button when a logo is set", () => {
    setup({ value: LOGO });

    const preview = screen.getByTestId("logo-upload-preview");
    expect(preview).toHaveAttribute("src", LOGO);
    expect(preview.className).toContain("object-contain");
    expect(screen.getByRole("button", { name: "Change image" })).toBeInTheDocument();
    expect(screen.getByText(/replaces the generated shield/)).toBeInTheDocument();
  });

  it("removes the logo and tells the parent", () => {
    const { onChange, onInteract } = setup({ value: LOGO });

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onInteract).toHaveBeenCalled();
  });

  it("returns focus to the visible upload button after removing, never to the hidden input", () => {
    setup({ value: LOGO });

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(screen.getByRole("button", { name: "Change image" })).toHaveFocus();
    expect(screen.getByTestId("logo-file-input")).not.toHaveFocus();
  });

  it("hides the file input from assistive technology so the button is the only control", () => {
    setup();

    expect(screen.getByTestId("logo-file-input")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("logo-file-input")).toHaveAttribute("tabindex", "-1");
  });

  it.each([
    ["unsupportedType", "Use a PNG, JPEG or WebP image. SVG and other formats are not accepted."],
    ["fileTooLarge", "That file is larger than 2 MB. Pick a smaller image."],
    ["unreadable", "That image could not be read. Try another file."],
    ["invalid", "That image could not be used as a badge. Try another file."],
    ["tooBig", "That image is too large to use. Try a smaller one."],
    ["failed", "The badge could not be prepared. Try again."],
  ] as const)("shows the localized message for %s in an alert", async (code, message) => {
    build.mockRejectedValue(new LogoUploadError(code));
    const { onChange } = setup({ value: LOGO });

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats an unexpected failure as a generic error", async () => {
    build.mockRejectedValue(new Error("boom"));
    setup();

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent("The badge could not be prepared. Try again.");
  });

  it("clears a previous error when a new file works", async () => {
    build.mockRejectedValueOnce(new LogoUploadError("unreadable")).mockResolvedValueOnce(LOGO);
    const { onChange } = setup();

    pick(png());
    await screen.findByRole("alert");
    pick(png());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(LOGO));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a result that arrives after the logo was removed", async () => {
    let finish: (value: string) => void = () => undefined;
    build.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    const { onChange } = setup({ value: LOGO });

    pick(png());
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    finish("data:image/png;base64,LATE");
    await Promise.resolve();
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a backend rejection of the logo from the wire form", () => {
    setup({ backendError: "Invalid club logo: too_big_dimensions" });

    expect(screen.getByRole("alert")).toHaveTextContent("That image is too large to use. Try a smaller one.");
  });

  it("disables the control while the club is being created", () => {
    setup({ disabled: true });

    expect(screen.getByRole("button", { name: "Upload your badge" })).toBeDisabled();
  });
});
