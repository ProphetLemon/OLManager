import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SplitButton } from "@/ui-v2/components/ui/split-button"

function setup(extra: Partial<React.ComponentProps<typeof SplitButton>> = {}) {
  const onClick = vi.fn()
  const onSkip = vi.fn()
  render(
    <SplitButton
      label="Continue"
      onClick={onClick}
      menuLabel="More ways to advance"
      items={[
        { id: "skip", label: "Skip to match day", onSelect: onSkip },
        { id: "off", label: "Unavailable", onSelect: vi.fn(), disabled: true },
      ]}
      {...extra}
    />,
  )
  return { onClick, onSkip, chevron: screen.getByRole("button", { name: "More ways to advance" }) }
}

describe("SplitButton", () => {
  it("fires the main action without opening the menu", () => {
    const { onClick, chevron } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(chevron).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("opens with ArrowDown, exposes menuitems and selects one", async () => {
    const { onSkip, chevron } = setup()
    expect(chevron).toHaveAttribute("aria-haspopup", "menu")
    act(() => chevron.focus())
    fireEvent.keyDown(chevron, { key: "ArrowDown" })
    expect(await screen.findByRole("menu")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "Skip to match day" }))
    expect(onSkip).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("closes with Escape and returns focus to the chevron", async () => {
    const { chevron } = setup()
    act(() => chevron.focus())
    fireEvent.mouseDown(chevron)
    fireEvent.mouseUp(chevron)
    fireEvent.click(chevron)
    const menu = await screen.findByRole("menu")
    await waitFor(() => expect(chevron).toHaveAttribute("aria-expanded", "true"))
    fireEvent.keyDown(menu, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    await waitFor(() => expect(chevron).toHaveFocus())
  })

  it("disables both halves while loading", () => {
    const { chevron } = setup({ loading: true })
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled()
    expect(chevron).toBeDisabled()
  })
})
