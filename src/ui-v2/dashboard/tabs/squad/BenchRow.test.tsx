import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { PlayerCardModel } from "@/lib/squad/cards"
import { BenchRow } from "./BenchRow"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? _key),
  }),
}))

const MODEL: PlayerCardModel = {
  id: "p1",
  name: "Send0o",
  role: "TOP",
  ovr: 70,
  age: 22,
  wage: 211000,
  wageLabel: "€211,000",
  wageCompact: "€211K",
  energy: 80,
  morale: 70,
  fitness: 90,
  contractEnd: "2027-06-30",
  contractEndLabel: "30 Jun 2027",
  contractRisk: "ok",
  isImport: false,
  nationalityCode: null,
  nationalityName: "Spain",
  photo: null,
  transferListed: false,
}

describe("BenchRow", () => {
  it("shows the wage in the same compact format as the starter cards", () => {
    render(
      <ul>
        <BenchRow
          model={MODEL}
          loanListed={false}
          onOpen={vi.fn()}
          onToggleTransfer={vi.fn()}
          onToggleLoan={vi.fn()}
        />
      </ul>,
    )
    expect(screen.getByText("€211K")).toBeInTheDocument()
    expect(screen.queryByText("€211,000")).not.toBeInTheDocument()
    // The exact figure stays available as a tooltip.
    expect(screen.getByTitle("€211,000")).toBeInTheDocument()
  })
})
