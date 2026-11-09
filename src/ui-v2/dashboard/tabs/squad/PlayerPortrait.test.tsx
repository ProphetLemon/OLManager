import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PlayerPortrait } from "./PlayerPortrait"

describe("PlayerPortrait", () => {
  it("shows the photo when the source loads", () => {
    const { container } = render(<PlayerPortrait src="/p.png" />)
    expect(container.querySelector("img")).toHaveAttribute("src", "/p.png")
    expect(container.querySelector("[data-slot='player-silhouette']")).toBeNull()
  })

  it("shows the silhouette, not an empty circle, without a photo", () => {
    const { container } = render(<PlayerPortrait src={null} />)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("[data-slot='player-silhouette']")).not.toBeNull()
  })

  it.each(["round", "bust"] as const)("swaps a failed %s photo for the silhouette", (shape) => {
    const { container } = render(<PlayerPortrait src="/missing.png" shape={shape} />)
    fireEvent.error(container.querySelector("img") as HTMLImageElement)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("[data-slot='player-silhouette']")).not.toBeNull()
  })

  it("tries again when the source changes after a failure", () => {
    const { container, rerender } = render(<PlayerPortrait src="/missing.png" />)
    fireEvent.error(container.querySelector("img") as HTMLImageElement)
    rerender(<PlayerPortrait src="/ok.png" />)
    expect(container.querySelector("img")).toHaveAttribute("src", "/ok.png")
  })
})
