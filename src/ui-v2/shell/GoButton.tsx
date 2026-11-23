import { Search } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { IconTip } from "@/ui-v2/components/ui/icon-tip";
import { cn } from "@/ui-v2/lib/utils";

import { RAIL_FOCUS_CLASS, RAIL_LABEL_CLASS, RAIL_STOP_CLASS, RAIL_STOP_LABELLED_CLASS } from "./RailItem";
import { railCellClass } from "./RailUtility";
import { GO_ROW_MARGIN_PX } from "./railMode";

/** The row's margin above and below: half the reserve's, so the two cannot drift. */
const GO_ROW_MARGIN_Y = `${GO_ROW_MARGIN_PX / 2}px`;

/**
 * Go's id in every mode: the rail's roving row id, and the DOM id the palette gets as its
 * opener, so focus follows it across mode changes and returns to it when the palette closes.
 */
export const GO_ID = "util:go";

/** `row` in Tree, `cell` in desktop Split and on the end-of-season rail, `stop` on Android. */
export type GoVariant = "row" | "cell" | "stop";

interface GoButtonProps {
  variant: GoVariant;
  onClick: () => void;
  tabIndex?: 0 | -1;
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * The rail's way into the Go palette (spec section 7.1). It opens a dialog and never marks a
 * page as current. R40, the visible text is in the name: the row and the stop are named by
 * their own text, "Go to…" and the short "Go", and only the icon-only cell has an
 * `aria-label`, the same text its tip shows.
 */
export function GoButton({ variant, onClick, tabIndex, buttonRef }: GoButtonProps) {
  const { t } = useTranslation();
  const go = t("onAir.nav.go", { defaultValue: "Go to…" });
  const shared = {
    ref: buttonRef,
    type: "button" as const,
    id: GO_ID,
    tabIndex,
    onClick,
    "aria-haspopup": "dialog" as const,
    "data-nav-id": GO_ID,
    "data-slot": "go-button",
    "data-variant": variant,
  };
  const icon = <Search className="size-[var(--nav-icon)] shrink-0" aria-hidden="true" />;

  if (variant === "cell") {
    return (
      <button {...shared} aria-label={go} className={railCellClass()}>
        <IconTip label={go} followFocus className="inline-flex">
          {icon}
        </IconTip>
      </button>
    );
  }

  if (variant === "stop") {
    return (
      <button
        {...shared}
        className={cn(
          RAIL_STOP_CLASS,
          RAIL_STOP_LABELLED_CLASS,
          RAIL_FOCUS_CLASS,
          "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {icon}
        <span data-slot="go-label" className={cn(RAIL_LABEL_CLASS, "font-medium")}>
          {t("onAir.nav.goShort", { defaultValue: "Go" })}
        </span>
      </button>
    );
  }

  // Tree: a row above the scroller, styled like a search field, one line in the tree rail.
  return (
    <button
      {...shared}
      style={{ marginTop: GO_ROW_MARGIN_Y, marginBottom: GO_ROW_MARGIN_Y }}
      className={cn(
        "mx-[6px] flex h-[var(--go-row)] w-[calc(100%-12px)] shrink-0 items-center gap-2 rounded-md border border-line px-3",
        "whitespace-nowrap text-start text-nav text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        RAIL_FOCUS_CLASS,
      )}
    >
      {icon}
      <span data-slot="go-label">{go}</span>
    </button>
  );
}
