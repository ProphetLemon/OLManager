import { fireEvent, render, screen, within } from "@testing-library/react"
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
  it("shows at most five rows and the unread count", () => {
    render(
      <InboxPanel
        messages={[msg(1), msg(2), msg(3), msg(4), msg(5), msg(6)]}
        unreadCount={5}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getAllByRole("listitem")).toHaveLength(5)
    expect(screen.queryByText("Subject 6")).toBeNull()
    expect(screen.getByText("5 unread")).toBeInTheDocument()
  })

  it("puts the category tag before the subject and shows no raw date", () => {
    render(<InboxPanel messages={[msg(1, { date: "2027-10-05T09:00:00Z" })]} unreadCount={0} onOpen={vi.fn()} />)
    const row = screen.getByRole("button", { name: /Subject 1/ })
    const tag = within(row).getByText("Finance")
    const subject = within(row).getByText("Subject 1")
    expect(tag.compareDocumentPosition(subject) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/2027-10-05/)).toBeNull()
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

  it("keeps the header on one line: the title truncates while the pill and link hold their width", () => {
    render(<InboxPanel messages={[msg(1)]} unreadCount={13} onOpen={vi.fn()} />)
    const title = screen.getByRole("heading", { name: "Inbox" })
    expect(title).toHaveClass("min-w-0", "truncate", "whitespace-nowrap")
    expect(title).toHaveAttribute("title", "Inbox")
    expect(document.querySelector('[data-slot="inbox-unread-count"]')).toHaveClass("shrink-0", "whitespace-nowrap")
    expect(screen.getByRole("button", { name: "Open inbox" })).toHaveClass("shrink-0", "whitespace-nowrap")
  })

  it("truncates the subject while the category tag keeps its width, and scrolls inside the panel", () => {
    render(<InboxPanel messages={[msg(1)]} unreadCount={0} onOpen={vi.fn()} />)
    expect(screen.getByText("Subject 1")).toHaveClass("min-w-0", "flex-1", "truncate")
    expect(screen.getByText("Finance").closest("span.w-20")).toHaveClass("shrink-0", "min-w-20")
    expect(document.querySelector('[data-slot="inbox-panel"]')).toHaveClass("h-full", "min-h-0")
    expect(document.querySelector('[data-slot="inbox-list"]')).toHaveClass("min-h-0", "flex-1", "overflow-y-auto")
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
