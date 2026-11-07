import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, SocialPostData } from "@/store/gameStore";
import { SocialTabV2 } from "./SocialTabV2";

const social = vi.hoisted(() => ({
  createManagerSocialPost: vi.fn(),
  relocalizeSocialFeed: vi.fn(),
}));
vi.mock("@/services/socialService", () => social);
vi.mock("@/store/gameStore", async (orig) => ({
  ...(await orig<typeof import("@/store/gameStore")>()),
  useActiveLeague: (g: { __league?: unknown }) => g.__league,
}));
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    i18n: { language: "en" },
  }),
}));

function post(over: Partial<SocialPostData> = {}): SocialPostData {
  return {
    id: "p1", author_name: "Fan One", author_handle: "@fan", author_type: "Fan",
    body: "Great match", date: "2026-08-01", likes: 1500, reposts: 2, replies: 3,
    sentiment: "Hype", media_url: null, ...over,
  } as SocialPostData;
}

function state(posts: SocialPostData[], competition = "lec"): GameStateData {
  return {
    social_posts: posts, teams: [], players: [], social_accounts: [],
    __league: { competition_id: competition, name: "Other League" },
  } as unknown as GameStateData;
}

describe("SocialTabV2", () => {
  beforeEach(() => {
    social.createManagerSocialPost.mockReset();
    social.relocalizeSocialFeed.mockReset().mockResolvedValue(null);
  });

  it("shows the coming-soon placeholder outside the LEC", () => {
    render(<SocialTabV2 gameState={state([post()], "lck")} onGameUpdate={vi.fn()} />);
    expect(screen.getByText("social.comingSoonTitle")).toBeInTheDocument();
    expect(screen.getByText(/Other League/)).toBeInTheDocument();
  });

  it("shows the empty timeline state", () => {
    render(<SocialTabV2 gameState={state([])} onGameUpdate={vi.fn()} />);
    expect(screen.getByText("The timeline is quiet")).toBeInTheDocument();
  });

  it("renders posts, compact counts and toggles like/repost locally", () => {
    render(<SocialTabV2 gameState={state([post()])} onGameUpdate={vi.fn()} />);
    expect(screen.getByText("Great match")).toBeInTheDocument();
    const like = screen.getByRole("button", { name: /1\.5K/ });
    expect(like).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(like);
    expect(screen.getByRole("button", { name: /1\.5K/ })).toHaveAttribute("aria-pressed", "true");
    const repost = screen.getByRole("button", { name: /^\s*2\s*$/ });
    fireEvent.click(repost);
    expect(screen.getByRole("button", { name: /3/, pressed: true })).toBeInTheDocument();
  });

  it("publishes a manager post, updates the game and clears the composer", async () => {
    const updated = state([post()]);
    social.createManagerSocialPost.mockResolvedValue(updated);
    const onGameUpdate = vi.fn();
    render(<SocialTabV2 gameState={state([post()])} onGameUpdate={onGameUpdate} />);

    const publish = screen.getByRole("button", { name: "Postear" });
    expect(publish).toBeDisabled();
    const box = screen.getByPlaceholderText("¿Qué está pensando el míster hoy?");
    fireEvent.change(box, { target: { value: "  hola  " } });
    fireEvent.click(screen.getByRole("button", { name: "Postear" }));

    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(social.createManagerSocialPost).toHaveBeenCalledWith("hola");
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("shows the error when publishing fails", async () => {
    social.createManagerSocialPost.mockRejectedValue(new Error("boom"));
    render(<SocialTabV2 gameState={state([post()])} onGameUpdate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("¿Qué está pensando el míster hoy?"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Postear" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("relocalizes the feed once for the active language", async () => {
    const updated = state([post()]);
    social.relocalizeSocialFeed.mockResolvedValue(updated);
    const onGameUpdate = vi.fn();
    render(<SocialTabV2 gameState={state([post()])} onGameUpdate={onGameUpdate} />);
    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(social.relocalizeSocialFeed).toHaveBeenCalledWith("en");
  });
});
