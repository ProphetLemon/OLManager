import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Modal } from "./Modal";

// On a phone a card taller than the screen was cut off at both ends: its buttons could not be reached.
it("keeps a tall card inside the screen and lets it scroll", () => {
  render(
    <Modal open>
      <p>body</p>
    </Modal>,
  );

  const card = screen.getByText("body").parentElement;

  expect(card?.className).toContain("max-h-[90vh]");
  expect(card?.className).toContain("overflow-y-auto");
});
