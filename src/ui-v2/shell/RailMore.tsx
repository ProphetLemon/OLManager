import { Menu } from "@base-ui/react/menu";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type Ref } from "react";

import { cn } from "@/ui-v2/lib/utils";

import { RailItem } from "./RailItem";

export interface RailMoreItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  tone?: "default" | "danger";
}

interface RailMoreProps {
  /** "More" */
  label: string;
  items: RailMoreItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** More owns the current page while one of its tabs (News, Social, Manager) is active. */
  active?: boolean;
  tabIndex?: 0 | -1;
  buttonRef?: Ref<HTMLButtonElement>;
  "data-nav-id"?: string;
}

/**
 * Android's overflow stop: a menu of the destinations the 7-stop rail has no room for.
 * It is a stop of the rail (roving widget) that opens a Base UI menu anchored to it; the
 * menu's items are `--hit` high, Escape closes it and focus returns to the stop.
 */
export function RailMore({ label, items, open, onOpenChange, active, tabIndex, buttonRef, ...rest }: RailMoreProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const wasOpen = useRef(open);

  // Closing hands focus back to the stop, whatever closed the menu.
  useEffect(() => {
    if (wasOpen.current && !open) anchor?.focus();
    wasOpen.current = open;
  }, [open, anchor]);

  return (
    <>
      <RailItem
        icon={Ellipsis}
        label={label}
        active={active}
        tabIndex={tabIndex}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        buttonRef={(el) => {
          setAnchor(el);
          if (typeof buttonRef === "function") buttonRef(el);
          else if (buttonRef) (buttonRef as { current: HTMLButtonElement | null }).current = el;
        }}
        data-nav-id={rest["data-nav-id"]}
      />
      <Menu.Root open={open} onOpenChange={onOpenChange}>
        <Menu.Portal>
          <Menu.Positioner anchor={anchor} side="right" align="end" sideOffset={4} className="z-50">
            <Menu.Popup
              aria-label={label}
              className="min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md focus-visible:outline-hidden"
            >
              {items.map(({ id, label: itemLabel, icon: Icon, onSelect, tone = "default" }) => (
                <Menu.Item
                  key={id}
                  onClick={onSelect}
                  className={cn(
                    "flex min-h-[var(--hit)] cursor-default items-center gap-3 rounded-md px-3 font-heading text-nav focus-visible:outline-hidden data-[highlighted]:bg-muted data-[highlighted]:ring-[3px] data-[highlighted]:ring-inset data-[highlighted]:ring-ring",
                    tone === "danger" ? "text-negative" : "text-popover-foreground data-[highlighted]:text-foreground",
                  )}
                >
                  <Icon className="size-[var(--nav-icon)] shrink-0" aria-hidden="true" />
                  {itemLabel}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </>
  );
}
