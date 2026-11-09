import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LowerThird } from "@/ui-v2/components/ui/lower-third"

describe("LowerThird", () => {
  it("renders with only the required parts", () => {
    const { container } = render(<LowerThird tagLabel="Blocker" headline="Lineup incomplete" />)
    expect(screen.getByText("Blocker")).toBeInTheDocument()
    expect(screen.getByText("Lineup incomplete")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
    expect(container.firstElementChild).toHaveAttribute("data-severity", "soft")
  })

  it("fires the action exactly once per activation", () => {
    const onClick = vi.fn()
    render(
      <LowerThird
        tagLabel="Blocker"
        headline="Fix"
        consequence="You cannot play"
        action={{ label: "Fix lineup", onClick }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Fix lineup" }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByText("You cannot play")).toBeInTheDocument()
  })

  it("exposes a non-colour severity marker and respects disabled", () => {
    const onClick = vi.fn()
    const { container, rerender } = render(
      <LowerThird tagLabel="t" headline="h" severity="hard" action={{ label: "Go", onClick, disabled: true }} />,
    )
    expect(container.firstElementChild).toHaveAttribute("data-severity", "hard")
    expect(container.firstElementChild?.className).toContain("border-inline-start-style:solid")
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled()
    rerender(<LowerThird tagLabel="t" headline="h" severity="soft" />)
    expect(container.firstElementChild?.className).toContain("border-inline-start-style:dashed")
  })

  it("renders dismiss only when provided and uses the label", () => {
    const onDismiss = vi.fn()
    render(<LowerThird tagLabel="t" headline="h" onDismiss={onDismiss} dismissLabel="Hide" as="section" />)
    fireEvent.click(screen.getByRole("button", { name: "Hide" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
