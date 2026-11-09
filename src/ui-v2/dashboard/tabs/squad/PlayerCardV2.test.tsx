import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PlayerCardModel } from "@/lib/squad/cards"
import { PlayerCardV2 } from "./PlayerCardV2"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts?.[k] ?? "")),
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
  contractEnd: "2027-06-30",
  contractRisk: "ok",
  isImport: false,
  nationalityCode: null,
  photo: null,
  transferListed: false,
}

function setup(
  props: Partial<React.ComponentProps<typeof PlayerCardV2>> = {},
  model: Partial<PlayerCardModel> = {},
) {
  const onSelect = vi.fn()
  const onSwap = vi.fn()
  render(
    <PlayerCardV2
      model={{ ...MODEL, ...model }}
      slotRole="MID"
      selected={false}
      onSelect={onSelect}
      candidates={[
        { id: "b1", label: "Bench One" },
        { id: "b2", label: "Bench Two", disabled: true, reason: "Import limit reached" },
      ]}
      onSwap={onSwap}
      {...props}
    />,
  )
  return { onSelect, onSwap }
}

describe("PlayerCardV2", () => {
  it("selects through the main button and mirrors state in aria-pressed", () => {
    const { onSelect } = setup()
    const button = screen.getByRole("button", { name: /Faker/ })
    expect(button).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledWith("p1")
  })

  it("marks the selected card with aria-pressed and a visible tag, not colour alone", () => {
    setup({ selected: true })
    expect(screen.getByRole("button", { name: /Faker/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Selected")).toBeInTheDocument()
  })

  it("truncates the name and exposes it in a title", () => {
    setup({}, { name: "A Very Long Player Name That Cannot Fit" })
    const name = screen.getByTitle("A Very Long Player Name That Cannot Fit")
    expect(name).toHaveClass("truncate")
  })

  it("shows energy, morale and fitness meters", () => {
    setup()
    expect(screen.getAllByRole("meter").map((m) => m.getAttribute("aria-label"))).toEqual([
      "Energy",
      "Morale",
      "Fitness",
    ])
  })

  it("omits the fitness meter when the save has no fitness value", () => {
    setup({}, { fitness: null })
    expect(screen.queryByRole("meter", { name: "Fitness" })).toBeNull()
    expect(screen.getAllByRole("meter")).toHaveLength(2)
  })

  it("renders the import badge only for imports", () => {
    const { unmount } = render(
      <PlayerCardV2
        model={MODEL}
        slotRole="MID"
        selected={false}
        onSelect={vi.fn()}
        candidates={[]}
        onSwap={vi.fn()}
      />,
    )
    expect(screen.queryByTestId("import-badge")).toBeNull()
    unmount()
    setup({}, { isImport: true })
    expect(screen.getByTestId("import-badge")).toHaveTextContent("Import")
  })

  it("opens the swap menu from the keyboard and swaps to an enabled candidate", async () => {
    const { onSwap } = setup()
    const trigger = screen.getByRole("button", { name: "Swap Mid" })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const menu = await screen.findByRole("menu")
    const items = within(menu).getAllByRole("menuitem")
    expect(items).toHaveLength(2)
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Bench One/ }))
    expect(onSwap).toHaveBeenCalledWith("b1")
  })

  it("shows the reason on a disabled candidate and never swaps to it", async () => {
    const { onSwap } = setup()
    const trigger = screen.getByRole("button", { name: "Swap Mid" })
    act(() => trigger.focus())
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const disabled = await screen.findByRole("menuitem", { name: /Bench Two/ })
    expect(disabled).toHaveAttribute("aria-disabled", "true")
    expect(within(disabled).getByText("Import limit reached")).toBeInTheDocument()
    fireEvent.click(disabled)
    expect(onSwap).not.toHaveBeenCalled()
  })

  it("disables the swap trigger and shows busy state while saving", () => {
    setup({ saving: true })
    const trigger = screen.getByRole("button", { name: "Swap Mid" })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute("aria-busy", "true")
  })

  it("disables the swap trigger when there are no candidates", () => {
    setup({ candidates: [] })
    expect(screen.getByRole("button", { name: "Swap Mid" })).toBeDisabled()
  })

  it("flags a player who fills a slot outside his role", () => {
    setup({ outOfPosition: true })
    expect(screen.getByText("Out of position")).toBeInTheDocument()
  })

  it("does not flag an in-position player", () => {
    setup()
    expect(screen.queryByText("Out of position")).toBeNull()
  })

  it("exposes the OVR to assistive tech", () => {
    setup()
    expect(screen.getByRole("img", { name: "OVR 88" })).toBeInTheDocument()
  })
})
