import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerData } from "@/store/gameStore";
import TransferPlayerPicker from "./TransferPlayerPicker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function player(id: string): PlayerData {
  return {
    id,
    match_name: `Player ${id}`,
    full_name: `Full ${id}`,
    date_of_birth: "2000-01-01",
    position: "Forward",
    natural_position: "Forward",
    alternate_positions: [],
    market_value: 1_000_000,
  } as unknown as PlayerData;
}

const players = [player("a"), player("b"), player("c")];

describe("TransferPlayerPicker", () => {
  it("adds and removes players from the selection", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TransferPlayerPicker userPlayers={players} selectedPlayerIds={[]} onSelectedPlayersChange={onChange} currentDate="2025-01-15" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Player a/ }));
    expect(onChange).toHaveBeenLastCalledWith(["a"]);

    rerender(
      <TransferPlayerPicker userPlayers={players} selectedPlayerIds={["a"]} onSelectedPlayersChange={onChange} currentDate="2025-01-15" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Player a/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("disables unselected players once two are selected", () => {
    render(
      <TransferPlayerPicker userPlayers={players} selectedPlayerIds={["a", "b"]} onSelectedPlayersChange={vi.fn()} currentDate="2025-01-15" />,
    );
    expect(screen.getByRole("button", { name: /Player c/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Player a/ })).not.toBeDisabled();
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(
      <TransferPlayerPicker userPlayers={[]} selectedPlayerIds={[]} onSelectedPlayersChange={vi.fn()} currentDate="2025-01-15" />,
    );
    expect(screen.getByText("transfers.noPlayersAvailable")).toBeInTheDocument();
  });
});
