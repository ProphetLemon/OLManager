import { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SegmentedControl } from "@/ui-v2/components/ui/segmented-control"

const OPTIONS = [
  { value: "all", label: "All", count: 5 },
  { value: "top", label: "Top" },
  { value: "mid", label: "Mid", disabled: true },
  { value: "adc", label: "ADC" },
]

function Harness({ initial = "all" }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <SegmentedControl value={value} onValueChange={setValue} options={OPTIONS} ariaLabel="Role" />
}

describe("SegmentedControl", () => {
  it("is a labelled radiogroup with one tab stop", () => {
    render(<Harness />)
    expect(screen.getByRole("radiogroup", { name: "Role" })).toBeInTheDocument()
    const tabbable = screen.getAllByRole("radio").filter((r) => r.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAccessibleName(/All/)
    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute("aria-checked", "true")
  })

  it("moves selection and focus with arrows, skipping disabled", () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByRole("radio", { name: /All/ }), { key: "ArrowRight" })
    const top = screen.getByRole("radio", { name: "Top" })
    expect(top).toHaveAttribute("aria-checked", "true")
    expect(top).toHaveFocus()
    fireEvent.keyDown(top, { key: "ArrowRight" })
    expect(screen.getByRole("radio", { name: "ADC" })).toHaveAttribute("aria-checked", "true")
    fireEvent.keyDown(screen.getByRole("radio", { name: "ADC" }), { key: "ArrowRight" })
    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute("aria-checked", "true")
  })

  it("supports Home and End and click", () => {
    render(<Harness initial="top" />)
    fireEvent.keyDown(screen.getByRole("radio", { name: "Top" }), { key: "End" })
    expect(screen.getByRole("radio", { name: "ADC" })).toHaveAttribute("aria-checked", "true")
    fireEvent.keyDown(screen.getByRole("radio", { name: "ADC" }), { key: "Home" })
    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByRole("radio", { name: "Top" }))
    expect(screen.getByRole("radio", { name: "Top" })).toHaveAttribute("aria-checked", "true")
  })
})
