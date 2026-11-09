import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PlayerCardModel } from "@/lib/squad/cards"
import { SelectedPlayerBar } from "./SelectedPlayerBar"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? _key),
  }),
}))

const MODEL: PlayerCardModel = {
  id: "p1",
  name: "Faker",
  role: "MID",
  ovr: 88,
  age: 28,
  wage: 354000,
  wageLabel: "€354,000",
  energy: 80,
  morale: 70,
  fitness: 90,
  contractEnd: "2027-06-30T00:00:00Z",
  contractRisk: "ok",
  isImport: false,
  nationalityCode: null,
  photo: null,
  transferListed: false,
}

function setup(model: Partial<PlayerCardModel> = {}) {
  const handlers = {
    onOpenProfile: vi.fn(),
    onRenew: vi.fn(),
    onToggleTransferList: vi.fn(),
    onClose: vi.fn(),
  }
  render(<SelectedPlayerBar model={{ ...MODEL, ...model }} {...handlers} />)
  return handlers
}

describe("SelectedPlayerBar", () => {
  it("is a labelled region with name, contract date and full wage", () => {
    setup()
    expect(screen.getByRole("region", { name: "Selected player" })).toBeInTheDocument()
    expect(screen.getByText("Faker")).toBeInTheDocument()
    expect(screen.getByText("2027-06-30")).toBeInTheDocument()
    expect(screen.getByText(/€354,000/)).toBeInTheDocument()
  })

  it("fires each action with the player id", () => {
    const h = setup()
    fireEvent.click(screen.getByRole("button", { name: "Profile" }))
    fireEvent.click(screen.getByRole("button", { name: "Renew" }))
    fireEvent.click(screen.getByRole("button", { name: "List for transfer" }))
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(h.onOpenProfile).toHaveBeenCalledWith("p1")
    expect(h.onRenew).toHaveBeenCalledWith("p1")
    expect(h.onToggleTransferList).toHaveBeenCalledWith("p1")
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it("flips the transfer toggle label when already listed", () => {
    setup({ transferListed: true })
    expect(screen.getByRole("button", { name: "Remove from transfer list" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "List for transfer" })).toBeNull()
  })

  it("adds a text tag for contract risk and none for ok contracts", () => {
    const { unmount } = render(
      <SelectedPlayerBar
        model={MODEL}
        onOpenProfile={vi.fn()}
        onRenew={vi.fn()}
        onToggleTransferList={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText("Alert")).toBeNull()
    unmount()
    setup({ contractRisk: "critical" })
    expect(screen.getByText("Alert")).toBeInTheDocument()
  })

  it("handles a missing age and contract end without inventing values", () => {
    setup({ age: null, contractEnd: null })
    expect(screen.queryByText("Age")).toBeNull()
    expect(screen.getByText("-")).toBeInTheDocument()
  })
})
