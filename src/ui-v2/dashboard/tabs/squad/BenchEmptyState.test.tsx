import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BenchEmptyState } from "./BenchEmptyState"
import { StartingFiveGrid } from "./StartingFiveGrid"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? _key),
  }),
}))

describe("BenchEmptyState", () => {
  it("offers market and academy when the bench is truly empty", () => {
    const onBrowseMarket = vi.fn()
    const onOpenAcademy = vi.fn()
    render(
      <BenchEmptyState filtered={false} onBrowseMarket={onBrowseMarket} onOpenAcademy={onOpenAcademy} />,
    )
    expect(screen.getByText("The bench is empty")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Browse market" }))
    fireEvent.click(screen.getByRole("button", { name: "Open academy" }))
    expect(onBrowseMarket).toHaveBeenCalledTimes(1)
    expect(onOpenAcademy).toHaveBeenCalledTimes(1)
  })

  it("explains the filter and offers to clear it in the filtered variant", () => {
    const onClearFilter = vi.fn()
    render(
      <BenchEmptyState
        filtered
        onBrowseMarket={vi.fn()}
        onOpenAcademy={vi.fn()}
        onClearFilter={onClearFilter}
      />,
    )
    expect(screen.getByText("No bench players for this role")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Browse market" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }))
    expect(onClearFilter).toHaveBeenCalledTimes(1)
  })

  it("renders no clear button when the filtered variant has no handler", () => {
    render(<BenchEmptyState filtered onBrowseMarket={vi.fn()} onOpenAcademy={vi.fn()} />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("StartingFiveGrid", () => {
  it("is a container-query wrapper with an auto-fit grid and no viewport breakpoints", () => {
    const { container } = render(
      <StartingFiveGrid>
        <div>one</div>
        <div>two</div>
      </StartingFiveGrid>,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain("[container-type:inline-size]")
    const grid = wrapper.firstElementChild as HTMLElement
    expect(grid.className).toContain("repeat(auto-fit,minmax(11rem,1fr))")
    expect(wrapper.outerHTML).not.toMatch(/(?:^|[\s"'])(?:sm|md|lg|xl):/)
    expect(grid.children).toHaveLength(2)
  })
})
