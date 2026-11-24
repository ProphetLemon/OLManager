import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { ScrimViewFrame } from "./ScrimViewFrame";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ScrimViewFrame body", () => {
  it("scrolls inside itself when its area is shorter than its content, instead of clipping", () => {
    render(
      <ScrimViewFrame title="Report" onBack={() => {}}>
        <p>content</p>
      </ScrimViewFrame>,
    );
    const body = document.querySelector('[data-slot="scrim-view-body"]') as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).not.toContain("overflow-hidden");
  });
});
