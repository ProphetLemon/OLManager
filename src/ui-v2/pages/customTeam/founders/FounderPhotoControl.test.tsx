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
vi.mock("@/lib/customTeam/portrait", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customTeam/portrait")>()),
  buildPortraitFromFile: build,
}));

import { LogoUploadError } from "@/lib/customTeam/logo";
import FounderPhotoControl from "./FounderPhotoControl";

const PHOTO = "data:image/png;base64,AAAA";

function setup(props: Partial<React.ComponentProps<typeof FounderPhotoControl>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <FounderPhotoControl
      playerId="gen-ray-mid-1"
      nick="Zed"
      roleLabel="Mid"
      photo={null}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, ...view };
}

const input = () => screen.getByTestId("founder-photo-input-gen-ray-mid-1");
const pick = (file: File) => fireEvent.change(input(), { target: { files: [file] } });
const png = () => new File(["x"], "me.png", { type: "image/png" });

describe("FounderPhotoControl", () => {
  beforeEach(() => {
    build.mockReset();
  });

  it("names the founder on the choose button and offers no remove button without a photo", () => {
    setup();

    expect(screen.getByRole("button", { name: "Add a photo for Zed, Mid" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Remove the photo/ })).toBeNull();
  });

  it("only offers image types the backend accepts, never SVG", () => {
    setup();

    expect(input().getAttribute("accept")).toContain("image/png");
    expect(input().getAttribute("accept")).not.toContain("svg");
  });

  it("opens the file picker from the button", () => {
    setup();
    const click = vi.spyOn(input(), "click");

    fireEvent.click(screen.getByRole("button", { name: "Add a photo for Zed, Mid" }));

    expect(click).toHaveBeenCalled();
  });

  it("reports the prepared photo once the file is ready", async () => {
    build.mockResolvedValue(PHOTO);
    const { onChange } = setup();

    pick(png());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(PHOTO));
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ name: "me.png" }));
  });

  it("previews the photo it was given and offers to replace or remove it", () => {
    setup({ photo: PHOTO });

    expect(screen.getByTestId("founder-photo-preview-gen-ray-mid-1")).toHaveAttribute("src", PHOTO);
    expect(screen.getByRole("button", { name: "Change the photo of Zed, Mid" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove the photo of Zed, Mid" })).toBeEnabled();
  });

  it("shows the default avatar while there is no photo", () => {
    setup();

    expect(screen.getByTestId("founder-photo-preview-gen-ray-mid-1")).toHaveAttribute(
      "src",
      "/default/defaultplayer.webp",
    );
  });

  it("replaces the photo when another file is picked", async () => {
    build.mockResolvedValue("data:image/png;base64,BBBB");
    const { onChange } = setup({ photo: PHOTO });

    pick(png());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("data:image/png;base64,BBBB"));
  });

  it("goes back to the default avatar on remove and keeps the focus on the choose button", () => {
    const { onChange } = setup({ photo: PHOTO });

    fireEvent.click(screen.getByRole("button", { name: "Remove the photo of Zed, Mid" }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: "Change the photo of Zed, Mid" })).toHaveFocus();
  });

  it.each([
    ["unsupportedType", "Use a PNG, JPEG or WebP image. SVG and other formats are not accepted."],
    ["fileTooLarge", "That file is larger than 2 MB. Pick a smaller image."],
    ["unreadable", "That image could not be read. Try another file."],
    ["invalid", "That image could not be used as a photo. Try another file."],
    ["tooBig", "That image is too large to use. Try a smaller one."],
    ["failed", "The photo could not be prepared. Try again."],
  ] as const)("announces %s as an alert and keeps the current photo", async (code, text) => {
    build.mockRejectedValue(new LogoUploadError(code));
    const { onChange } = setup({ photo: PHOTO });

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("founder-photo-preview-gen-ray-mid-1")).toHaveAttribute("src", PHOTO);
  });

  it("reports an unexpected failure with the generic message", async () => {
    build.mockRejectedValue(new Error("boom"));
    setup();

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent("The photo could not be prepared. Try again.");
  });

  it("clears the error when a later file works", async () => {
    build.mockRejectedValueOnce(new LogoUploadError("unreadable")).mockResolvedValueOnce(PHOTO);
    const { onChange } = setup();

    pick(png());
    await screen.findByRole("alert");
    pick(png());

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(PHOTO));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is not usable while the squad is loading", () => {
    setup({ disabled: true });

    expect(screen.getByRole("button", { name: "Add a photo for Zed, Mid" })).toBeDisabled();
    expect(input()).toBeDisabled();
  });
});
