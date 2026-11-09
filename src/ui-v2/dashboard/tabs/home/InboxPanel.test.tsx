import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { InboxPanel, type InboxPanelMessage } from "./InboxPanel"

const LABELS: Record<string, string> = {
  "inbox.categories.training": "Training",
  "inbox.categories.Finance": "Finance",
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; count?: number }) => {
      if (key in LABELS) return LABELS[key]
      return (opts?.defaultValue ?? key).replace("{{count}}", String(opts?.count ?? ""))
    },
  }),
}))

function msg(n: number, overrides: Partial<InboxPanelMessage> = {}): InboxPanelMessage {
  return {
    id: `m${n}`,
    subject: `Subject ${n}`,
    sender: `Sender ${n}`,
    date: "12 Mar",
    category: "Finance",
    categoryLabel: "Finance",
    unread: false,
    urgent: false,
    ...overrides,
  }
}

describe("InboxPanel", () => {
  it("shows at most three rows and the unread count", () => {
    render(
      <InboxPanel messages={[msg(1), msg(2), msg(3), msg(4)]} unreadCount={5} onOpen={vi.fn()} />,
    )
    expect(screen.getAllByRole("listitem")).toHaveLength(3)
    expect(screen.queryByText("Subject 4")).toBeNull()
    expect(screen.getByText("5 unread")).toBeInTheDocument()
  })

  it("hides the unread count when nothing is unread", () => {
    render(<InboxPanel messages={[msg(1)]} unreadCount={0} onOpen={vi.fn()} />)
    expect(screen.queryByText(/unread/i)).toBeNull()
  })

  it("gives unread rows an Unread text for assistive tech, read rows none", () => {
    render(
      <InboxPanel messages={[msg(1, { unread: true }), msg(2)]} unreadCount={1} onOpen={vi.fn()} />,
    )
    expect(screen.getByRole("button", { name: /Unread.*Subject 1/ })).toBeInTheDocument()
    expect(screen.getAllByText("Unread")).toHaveLength(1)
  })

  it("marks urgent messages with a text tag", () => {
    render(<InboxPanel messages={[msg(1, { urgent: true }), msg(2)]} unreadCount={0} onOpen={vi.fn()} />)
    expect(screen.getAllByText("Urgent")).toHaveLength(1)
  })

  it("resolves the lowercase training key when the label is missing", () => {
    render(
      <InboxPanel
        messages={[msg(1, { category: "Training", categoryLabel: "inbox.categories.Training" })]}
        unreadCount={0}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText("Training")).toBeInTheDocument()
  })

  it("falls back to the raw category when no label resolves", () => {
    render(
      <InboxPanel
        messages={[msg(1, { category: "Mystery", categoryLabel: "" })]}
        unreadCount={0}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText("Mystery")).toBeInTheDocument()
  })

  it("opens the message from a row and the inbox from the action", () => {
    const onOpen = vi.fn()
    render(<InboxPanel messages={[msg(1), msg(2)]} unreadCount={0} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("button", { name: /Subject 2/ }))
    expect(onOpen).toHaveBeenLastCalledWith("m2")
    fireEvent.click(screen.getByRole("button", { name: "Open inbox" }))
    expect(onOpen).toHaveBeenLastCalledWith()
  })

  it("renders the empty state with the open action", () => {
    render(<InboxPanel messages={[]} unreadCount={0} onOpen={vi.fn()} />)
    expect(screen.getByText("Your inbox is clear")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open inbox" })).toBeInTheDocument()
    expect(screen.queryByRole("list")).toBeNull()
  })
})
