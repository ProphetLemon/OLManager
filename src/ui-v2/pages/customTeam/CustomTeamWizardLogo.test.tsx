import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildBadgeDataUri } from "@/lib/customTeam";
import type { CompetitionSummary } from "@/store/types";
import { previewInvoke } from "./founders/foundersTestKit";
import type { PreviewCall } from "./founders/foundersTestKit";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

let previewCalls: PreviewCall[] = [];

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

import CustomTeamWizardV2 from "./CustomTeamWizardV2";

const LOGO = "data:image/png;base64,AAAA";

function team(id: string, name: string, short: string, reputation: number | null) {
  return {
    id,
    name,
    short_name: short,
    logo_url: null,
    country: "Atlantis",
    reputation,
    colors: null,
    ovr: null,
    player_count: 5,
  };
}

const competition: CompetitionSummary = {
  id: "les",
  name: "LES",
  region: "Spain",
  logo: null,
  tier: 2,
  legacy: false,
  active: true,
  team_count: 2,
  custom_team_allowed: true,
  teams: [team("les-a", "Falke Esports", "FAL", 300), team("les-b", "Other Club", "OTH", 180)],
};

function setup(props: Partial<React.ComponentProps<typeof CustomTeamWizardV2>> = {}) {
  const onConfirm = vi.fn();
  const view = render(
    <CustomTeamWizardV2
      competition={competition}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
      isSubmitting={false}
      error={null}
      {...props}
    />,
  );
  return { onConfirm, ...view };
}

const next = () => screen.getByRole("button", { name: "Next" });

function toBadgeStep() {
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Ray Esports" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "ES" } });
  fireEvent.click(next());
}

/** From the badge step to the squad step, with the replace choice made. */
async function toSquadStep() {
  fireEvent.click(next());
  fireEvent.click(screen.getByRole("radio", { name: /Falke Esports/ }));
  fireEvent.click(next());
  await screen.findByTestId("founder-mid");
}

async function uploadLogo() {
  fireEvent.change(screen.getByTestId("logo-file-input"), {
    target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
  });
  await waitFor(() => expect(screen.getByTestId("badge-preview-large")).toHaveAttribute("src", LOGO));
}

describe("CustomTeamWizardV2 badge upload", () => {
  beforeEach(() => {
    build.mockReset();
    build.mockResolvedValue(LOGO);
    previewCalls = [];
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(previewInvoke(previewCalls));
  });

  it("offers the upload control on the badge step only", () => {
    setup();
    expect(screen.queryByTestId("logo-file-input")).toBeNull();

    toBadgeStep();

    expect(screen.getByRole("button", { name: "Upload your badge" })).toBeInTheDocument();
  });

  it("shows the generated shield until an image is uploaded", () => {
    setup();
    toBadgeStep();

    const generated = buildBadgeDataUri("RAY", "#f97316", "#18181b");
    expect(screen.getByTestId("badge-preview-large")).toHaveAttribute("src", generated);
    expect(screen.getByTestId("badge-preview-small")).toHaveAttribute("src", generated);
  });

  it("previews the uploaded image in the shield slot and the square slot, uncropped", async () => {
    setup();
    toBadgeStep();

    await uploadLogo();

    for (const id of ["badge-preview-large", "badge-preview-small", "logo-upload-preview"]) {
      const image = screen.getByTestId(id);
      expect(image).toHaveAttribute("src", LOGO);
      expect(image.className).toContain("object-contain");
    }
  });

  it("keeps the chosen colours when an image is uploaded", async () => {
    setup();
    toBadgeStep();
    fireEvent.click(screen.getByRole("button", { name: "Colours #b91c1c and #fafafa" }));

    await uploadLogo();

    expect(screen.getByLabelText("Primary colour")).toHaveValue("#b91c1c");
  });

  it("returns to the generated shield when the image is removed", async () => {
    setup();
    toBadgeStep();
    await uploadLogo();

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(screen.getByTestId("badge-preview-large")).toHaveAttribute(
      "src",
      buildBadgeDataUri("RAY", "#f97316", "#18181b"),
    );
  });

  it("sends logo_data_uri with the spec when an image is set", async () => {
    const { onConfirm } = setup();
    toBadgeStep();
    await uploadLogo();
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm).toHaveBeenCalledWith(
      {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#f97316",
        secondary_color: "#18181b",
        logo_data_uri: LOGO,
        country: "ES",
        founding_seed: previewCalls[previewCalls.length - 1].seed,
      },
      "les-a",
    );
  });

  it("omits logo_data_uri when no image is set or it was removed", async () => {
    const { onConfirm } = setup();
    toBadgeStep();
    await uploadLogo();
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    const [spec] = onConfirm.mock.calls[0];
    expect(spec).not.toHaveProperty("logo_data_uri");
  });

  it("shows the uploaded image in the review summary", async () => {
    setup();
    toBadgeStep();
    await uploadLogo();
    fireEvent.click(next());

    const summary = screen.getByRole("region", { name: "Summary" });
    const image = summary.querySelector("img");
    expect(image).toHaveAttribute("src", LOGO);
    expect(image?.className).toContain("object-contain");
  });

  const rejected = (error: string) => (
    <CustomTeamWizardV2
      competition={competition}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
      isSubmitting={false}
      error={error}
    />
  );

  it("returns from the squad step to the badge step on a backend logo rejection", async () => {
    const { rerender } = setup();
    toBadgeStep();
    await toSquadStep();
    expect(screen.getByRole("heading", { name: "Founding squad" })).toBeInTheDocument();

    rerender(rejected("Invalid club logo: not_png"));

    expect(screen.getByRole("alert")).toHaveTextContent("That image could not be used as a badge");
    expect(screen.getByTestId("logo-file-input")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Founding squad" })).toBeNull();
  });

  it("keeps a founder rejection on the squad step when a logo is set", async () => {
    const raw = JSON.stringify({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
    const { rerender } = setup();
    toBadgeStep();
    await uploadLogo();
    await toSquadStep();

    rerender(rejected(raw));

    expect(screen.getByRole("heading", { name: "Founding squad" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Another player already uses this name.");
    expect(screen.queryByTestId("logo-file-input")).toBeNull();
  });

  it("sends the logo, the seed and the founder edits together", async () => {
    const { onConfirm } = setup();
    toBadgeStep();
    await uploadLogo();
    await toSquadStep();
    fireEvent.click(screen.getByRole("button", { name: /^Edit .*Mid$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nick"), { target: { value: "Ray" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm).toHaveBeenCalledWith(
      {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#f97316",
        secondary_color: "#18181b",
        logo_data_uri: LOGO,
        country: "ES",
        founding_seed: previewCalls[previewCalls.length - 1].seed,
        founder_overrides: { mid: { nick: "Ray" } },
      },
      "les-a",
    );
  });
});
