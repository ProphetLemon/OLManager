import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { StandingRow, StandingsPanelData } from "@/lib/home/standings"
import { StandingsPanel } from "./StandingsPanel"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}))

function row(position: number, overrides: Partial<StandingRow> = {}): StandingRow {
  return {
    position,
    teamId: `t${position}`,
    shortName: `T${position}`,
    name: `Team Number ${position}`,
    logoUrl: null,
    won: 10 - position,
    lost: position,
    points: 0,
    isMe: false,
    movement: null,
    ...overrides,
  }
}

function data(overrides: Partial<StandingsPanelData> = {}): StandingsPanelData {
  return {
    rows: [row(1), row(2), row(3)],
    gapBefore: null,
    preseason: false,
    competitionName: "LEC",
    season: 2026,
    ...overrides,
  }
}

describe("StandingsPanel", () => {
  it("renders table semantics with a caption and column headers", () => {
    render(<StandingsPanel data={data()} onOpenTeams={vi.fn()} />)
    const table = screen.getByRole("table", { name: "Standings: LEC 2026" })
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3)
    expect(within(table).getByRole("columnheader", { name: "W-L" })).toHaveAttribute("scope", "col")
    expect(within(table).getAllByRole("row")).toHaveLength(4)
    expect(within(table).getByText("9-1")).toBeInTheDocument()
  })

  it("marks the user row with aria-current and a visible You tag", () => {
    render(
      <StandingsPanel data={data({ rows: [row(1), row(2, { isMe: true })] })} onOpenTeams={vi.fn()} />,
    )
    const current = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-current") === "true")
    expect(current).toHaveLength(1)
    expect(within(current[0]).getByText("You")).toBeInTheDocument()
    expect(within(current[0]).getByText("T2")).toBeInTheDocument()
  })

  it("renders a gap divider only before the indicated row", () => {
    const rows = [row(1), row(2), row(9, { isMe: true })]
    const { container } = render(
      <StandingsPanel data={data({ rows, gapBefore: 2 })} onOpenTeams={vi.fn()} />,
    )
    const gap = container.querySelector('[data-slot="standings-gap"]')
    expect(gap).not.toBeNull()
    expect(gap?.nextElementSibling).toHaveAttribute("aria-current", "true")
    expect(within(gap as HTMLElement).getByText("Gap in the table")).toBeInTheDocument()
  })

  it("omits the gap row when gapBefore is null", () => {
    const { container } = render(<StandingsPanel data={data()} onOpenTeams={vi.fn()} />)
    expect(container.querySelector('[data-slot="standings-gap"]')).toBeNull()
  })

  it("shows the Promoted tag only for promoted rows", () => {
    render(
      <StandingsPanel
        data={data({ rows: [row(1, { movement: "promoted" }), row(2)] })}
        onOpenTeams={vi.fn()}
      />,
    )
    expect(screen.getAllByText("Promoted")).toHaveLength(1)
  })

  it("shows the preseason note", () => {
    const { rerender } = render(<StandingsPanel data={data({ preseason: true })} onOpenTeams={vi.fn()} />)
    expect(screen.getByText("Season not started")).toBeInTheDocument()
    rerender(<StandingsPanel data={data()} onOpenTeams={vi.fn()} />)
    expect(screen.queryByText("Season not started")).toBeNull()
  })

  it("opens Teams from a row button, with the full name as its tooltip", () => {
    const onOpenTeams = vi.fn()
    render(<StandingsPanel data={data()} onOpenTeams={onOpenTeams} />)
    const button = screen.getAllByRole("button")[0]
    expect(button).toHaveAttribute("title", "Team Number 1")
    fireEvent.click(button)
    expect(onOpenTeams).toHaveBeenCalledTimes(1)
  })

  it("sets the user row name in foreground text on the club wash", () => {
    render(<StandingsPanel data={data({ rows: [row(1), row(2, { isMe: true })] })} onOpenTeams={vi.fn()} />)
    const meRow = document.querySelector('tr[data-me="true"]') as HTMLElement
    expect(meRow.className).toContain("bg-club-wash")
    expect(meRow.innerHTML).not.toContain("text-muted-foreground")
  })
})
