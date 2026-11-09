import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { CallItem } from "@/lib/dashboard/needsYourCall"
import { NeedsYourCallPanel } from "./NeedsYourCallPanel"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; count?: number }) =>
      (opts?.defaultValue ?? key).replace("{{count}}", String(opts?.count ?? "")),
  }),
}))

function makeItem(n: number, overrides: Partial<CallItem> = {}): CallItem {
  return {
    id: `blocker:${n}`,
    kind: "blocker",
    severity: "hard",
    tagKey: "onAir.tags.blocker",
    tagTone: "negative",
    headline: `Headline ${n}`,
    consequence: `Consequence ${n}`,
    actionLabelKey: "onAir.calls.actions.fixLineup",
    target: { tab: "Squad" },
    ...overrides,
  }
}

const items = (count: number) => Array.from({ length: count }, (_, i) => makeItem(i + 1))

describe("NeedsYourCallPanel notices", () => {
  const notice = makeItem(1, {
    id: "alert:scrim_auto_delegate_notice",
    kind: "alert",
    severity: "info",
    tagTone: "info",
    tagKey: "onAir.tags.alert",
  })

  it("uses a neutral heading, no count and no resolve copy when only notices are present", () => {
    render(<NeedsYourCallPanel items={[notice]} total={1} decisions={0} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.getByRole("region", { name: "Worth a look" })).toBeInTheDocument()
    expect(screen.queryByText("Resolve these before you continue.")).toBeNull()
    expect(document.querySelector('[data-slot="needs-your-call-count"]')).toBeNull()
    expect(screen.getByText("Worth a look", { selector: '[data-slot="needs-your-call-live"]' })).toBeInTheDocument()
    expect(screen.getByText("Headline 1")).toBeInTheDocument()
  })

  it("counts only decisions when a notice sits next to a blocker", () => {
    render(<NeedsYourCallPanel items={[makeItem(2), notice]} total={2} decisions={1} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.getByRole("region", { name: "Needs your call" })).toBeInTheDocument()
    expect(screen.getByText("Resolve these before you continue.")).toBeInTheDocument()
    expect(document.querySelector('[data-slot="needs-your-call-count"]')).toHaveTextContent("1")
  })

  it("keeps the review action working for a notice", () => {
    const onAct = vi.fn()
    render(<NeedsYourCallPanel items={[notice]} total={1} decisions={0} hiddenContracts={0} onAct={onAct} />)
    fireEvent.click(screen.getByRole("button", { name: "Fix lineup" }))
    expect(onAct).toHaveBeenCalledWith(notice)
  })
})

describe("NeedsYourCallPanel", () => {
  it("renders a labelled, focusable landmark with one lower-third per item", () => {
    render(<NeedsYourCallPanel items={items(2)} total={2} hiddenContracts={0} onAct={vi.fn()} />)
    const section = screen.getByRole("region", { name: "Needs your call" })
    expect(section).toHaveAttribute("id", "needs-your-call")
    expect(section).toHaveAttribute("tabindex", "-1")
    expect(within(section).getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getAllByText("Blocker")).toHaveLength(2)
    expect(screen.getByText("Consequence 1")).toBeInTheDocument()
  })

  it("fills its cell and scrolls the rows inside the panel", () => {
    render(<NeedsYourCallPanel items={items(6)} total={6} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.getByRole("region", { name: "Needs your call" })).toHaveClass("h-full", "min-h-0")
    const list = document.querySelector('[data-slot="needs-list"]') as HTMLElement
    expect(list).toHaveClass("min-h-0", "flex-1", "overflow-y-auto")
    for (const row of within(list).getAllByRole("listitem")) expect(row).toHaveClass("shrink-0")
  })

  it("passes the exact item to onAct when its action is pressed", () => {
    const onAct = vi.fn()
    const list = items(2)
    render(<NeedsYourCallPanel items={list} total={2} hiddenContracts={0} onAct={onAct} />)
    fireEvent.click(screen.getAllByRole("button", { name: "Fix lineup" })[1])
    expect(onAct).toHaveBeenCalledTimes(1)
    expect(onAct).toHaveBeenCalledWith(list[1])
  })

  it("caps the list at four and expands in place", () => {
    render(<NeedsYourCallPanel items={items(6)} total={6} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(4)
    const toggle = screen.getByRole("button", { name: "See all 6" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(screen.getAllByRole("listitem")).toHaveLength(6)
    const less = screen.getByRole("button", { name: "Show less" })
    expect(less).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(less)
    expect(screen.getAllByRole("listitem")).toHaveLength(4)
  })

  it("shows no toggle when everything fits", () => {
    render(<NeedsYourCallPanel items={items(4)} total={4} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.queryByRole("button", { name: /See all/ })).toBeNull()
  })

  it("renders the empty state with a continue hint", () => {
    render(<NeedsYourCallPanel items={[]} total={0} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.queryByRole("list")).toBeNull()
    expect(screen.getAllByText("Nothing needs your call").length).toBeGreaterThan(0)
    expect(screen.getByText(/continue whenever/i)).toBeInTheDocument()
  })

  it("keeps the empty state to one compact line with a good-news tag and no duplicate heading", () => {
    const { container } = render(
      <NeedsYourCallPanel items={[]} total={0} hiddenContracts={0} onAct={vi.fn()} />,
    )
    const empty = container.querySelector('[data-slot="needs-your-call-empty"]') as HTMLElement
    expect(within(empty).getByText("All clear")).toBeInTheDocument()
    expect(within(empty).queryByText("Nothing needs your call")).toBeNull()
    expect(screen.getAllByRole("heading")).toHaveLength(1)
    expect(empty.className).toContain("min-h-16")
  })

  it("shows the subtitle and count only when something needs a call", () => {
    const { rerender } = render(
      <NeedsYourCallPanel items={items(3)} total={3} hiddenContracts={0} onAct={vi.fn()} />,
    )
    expect(screen.getByText("Resolve these before you continue.")).toBeInTheDocument()
    expect(screen.getByText("3", { selector: '[data-slot="needs-your-call-count"]' })).toBeInTheDocument()
    rerender(<NeedsYourCallPanel items={[]} total={0} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.queryByText("Resolve these before you continue.")).toBeNull()
  })

  it("announces the total through a polite live region that follows updates", () => {
    const { rerender } = render(
      <NeedsYourCallPanel items={items(1)} total={1} hiddenContracts={0} onAct={vi.fn()} />,
    )
    const live = screen.getByRole("status")
    expect(live).toHaveAttribute("aria-live", "polite")
    expect(live).toHaveTextContent("Needs your call: 1 to resolve")
    rerender(<NeedsYourCallPanel items={items(3)} total={3} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Needs your call: 3 to resolve")
    rerender(<NeedsYourCallPanel items={[]} total={0} hiddenContracts={0} onAct={vi.fn()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Nothing needs your call")
  })

  it("mentions contract rows hidden by the cap and counts them in the total", () => {
    render(<NeedsYourCallPanel items={items(1)} total={4} hiddenContracts={3} onAct={vi.fn()} />)
    expect(screen.getByText("3 more contract renewals not shown")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("4 to resolve")
  })
})
