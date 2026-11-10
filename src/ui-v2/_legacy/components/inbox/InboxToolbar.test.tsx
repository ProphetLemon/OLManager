import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import InboxToolbar from "@/ui-v2/_legacy/components/inbox/InboxToolbar";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("InboxToolbar category chips", () => {
  it("shows a label, not a raw key, for the Training category sent by the backend", () => {
    const noop = vi.fn();
    render(
      <InboxToolbar
        allMessagesCount={2}
        bulkSelectionEnabled={false}
        categories={["Training", "Finance"]}
        categoryCounts={new Map([["Training", 1], ["Finance", 1]])}
        categoryFilter={null}
        selectedMessageCount={0}
        sortOrder="newest"
        unreadCount={0}
        onClearOld={noop}
        onDeleteSelected={noop}
        onMarkAllRead={noop}
        onShowAll={noop}
        onShowUnread={noop}
        onSortOrderChange={noop}
        onToggleBulkSelectionMode={noop}
        onToggleCategory={noop}
      />,
    );

    expect(screen.getByText(/Training \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Finance \(1\)/)).toBeTruthy();
    expect(screen.queryByText(/inbox\.categories/)).toBeNull();
  });
});
