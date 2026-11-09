import { useState, type ReactNode } from "react"
import { Menu } from "@base-ui/react/menu"
import { ChevronDown, Loader2 } from "lucide-react"

import { Button, buttonVariants } from "@/ui-v2/components/ui/button"
import { cn } from "@/ui-v2/lib/utils"

export interface SplitButtonItem {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
}

export interface SplitButtonProps {
  label: ReactNode
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  menuLabel: string
  items: SplitButtonItem[]
  variant?: "club" | "default" | "outline"
  size?: "touch" | "default"
  className?: string
}

export function SplitButton({
  label,
  icon,
  onClick,
  disabled,
  loading,
  menuLabel,
  items,
  variant = "club",
  size = "touch",
  className,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false)
  // "club" resolves to the primary token, which is bound to --club.
  const buttonVariant = variant === "outline" ? "outline" : "default"
  const sizeClass = size === "touch" ? "h-[var(--hit)] min-w-[var(--hit)] px-4 text-sm" : ""
  const chevronSize = size === "touch" ? "h-[var(--hit)] w-[var(--hit)]" : "h-8 w-8"

  return (
    <div data-slot="split-button" className={cn("inline-flex items-stretch", className)}>
      <Button
        type="button"
        variant={buttonVariant}
        className={cn("gap-2 rounded-e-none", sizeClass)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        onClick={onClick}
      >
        {loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : icon}
        {label}
      </Button>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger
          aria-label={menuLabel}
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn(
            buttonVariants({ variant: buttonVariant }),
            "rounded-s-none border-s border-s-background/40 px-0",
            chevronSize,
          )}
        >
          <ChevronDown aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4} className="z-50">
            <Menu.Popup className="min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
              {items.map((item) => (
                <Menu.Item
                  key={item.id}
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  className="flex min-h-[var(--hit)] cursor-default items-center gap-2 rounded-md px-3 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[highlighted]:text-foreground [&_svg]:size-4"
                >
                  {item.icon}
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  )
}
