import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/customTeam/portrait", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customTeam/portrait")>()),
  buildPortraitFromFile: build,
}));

import CustomTeamWizardV2 from "./CustomTeamWizardV2";

const PHOTO = "data:image/png;base64,AAAA";
const OTHER_PHOTO = "data:image/png;base64,BBBB";

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

/** From the first step to the squad step, replacing a club. */
async function toSquadStep() {
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Ray Esports" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "ES" } });
  fireEvent.click(next());
  fireEvent.click(next());
  fireEvent.click(screen.getByRole("radio", { name: "Replace a club" }));
  fireEvent.click(screen.getByRole("radio", { name: /Falke Esports/ }));
  fireEvent.click(next());
  await screen.findByTestId("founder-mid");
}

const midInput = () => screen.getByTestId(`founder-photo-input-gen-ray-mid-1`);
const midPreview = () => screen.getByTestId("founder-photo-preview-gen-ray-mid-1");
const pickForMid = () =>
  fireEvent.change(midInput(), { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });

async function chooseMidPhoto(photo = PHOTO) {
  build.mockResolvedValueOnce(photo);
  pickForMid();
  await waitFor(() => expect(midPreview()).toHaveAttribute("src", photo));
}

describe("CustomTeamWizardV2 founder photos", () => {
  beforeEach(() => {
    build.mockReset();
    previewCalls = [];
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(previewInvoke(previewCalls));
  });

  it("offers a photo control for each of the five new players, on the default avatar", async () => {
    setup();
    await toSquadStep();

    for (const role of ["top", "jungle", "mid", "adc", "support"]) {
      expect(screen.getByTestId(`founder-photo-input-gen-ray-${role}-1`)).toBeInTheDocument();
    }
    expect(midPreview()).toHaveAttribute("src", "/default/defaultplayer.webp");
  });

  it("shows the chosen photo in the player's avatar slot", async () => {
    setup();
    await toSquadStep();

    await chooseMidPhoto();

    expect(midPreview()).toHaveAttribute("src", PHOTO);
    expect(screen.getByRole("button", { name: /Change the photo of .*Mid/ })).toBeEnabled();
  });

  it("keeps the photo when the user goes back a step and returns", async () => {
    setup();
    await toSquadStep();
    await chooseMidPhoto();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(next());
    await screen.findByTestId("founder-mid");

    expect(midPreview()).toHaveAttribute("src", PHOTO);
  });

  it("sends the photo with the spec, keyed by role", async () => {
    const { onConfirm } = setup();
    await toSquadStep();
    await chooseMidPhoto();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    const [spec] = onConfirm.mock.calls[0];
    expect(spec.founder_photos).toEqual({ mid: PHOTO });
  });

  it("does not ask for a new preview when a photo is chosen", async () => {
    setup();
    await toSquadStep();
    const previews = previewCalls.length;

    await chooseMidPhoto();

    expect(previewCalls).toHaveLength(previews);
    expect(screen.getByRole("button", { name: "Create club" })).toBeEnabled();
  });

  it("sends the replacement when the photo is changed", async () => {
    const { onConfirm } = setup();
    await toSquadStep();
    await chooseMidPhoto();

    await chooseMidPhoto(OTHER_PHOTO);
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm.mock.calls[0][0].founder_photos).toEqual({ mid: OTHER_PHOTO });
  });

  it("sends no photos after the only photo is removed", async () => {
    const { onConfirm } = setup();
    await toSquadStep();
    await chooseMidPhoto();

    fireEvent.click(screen.getByRole("button", { name: /Remove the photo of .*Mid/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(midPreview()).toHaveAttribute("src", "/default/defaultplayer.webp");
    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty("founder_photos");
  });

  it("creates a club without photos exactly as before", async () => {
    const { onConfirm } = setup();
    await toSquadStep();

    fireEvent.click(screen.getByRole("button", { name: "Create club" }));

    expect(onConfirm.mock.calls[0][0]).not.toHaveProperty("founder_photos");
  });

  it("refuses a file that cannot be used with a message and keeps the avatar", async () => {
    const { LogoUploadError } = await import("@/lib/customTeam/logo");
    setup();
    await toSquadStep();
    build.mockRejectedValueOnce(new LogoUploadError("fileTooLarge"));

    pickForMid();

    expect(await screen.findByRole("alert")).toHaveTextContent("That file is larger than 2 MB. Pick a smaller image.");
    expect(midPreview()).toHaveAttribute("src", "/default/defaultplayer.webp");
  });

  it("asks before a reroll throws the photos away", async () => {
    setup();
    await toSquadStep();
    await chooseMidPhoto();

    fireEvent.click(screen.getByRole("button", { name: /Reroll squad/ }));

    expect(screen.getByRole("group", { name: "Confirm reroll" })).toBeInTheDocument();
    expect(midPreview()).toHaveAttribute("src", PHOTO);
  });

  it("shows the rejection of a photo the backend refused, on the squad step", async () => {
    setup({ error: JSON.stringify({ kind: "invalid_photo", role: "SUPPORT", reason: "not_png" }) });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photo of the Support could not be used. Choose another one or remove it.",
    );
  });
});
