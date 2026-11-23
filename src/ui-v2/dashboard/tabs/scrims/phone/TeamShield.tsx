import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import { ClubShield } from "@/ui-v2/components/ui/club-shield";
import { cn } from "@/ui-v2/lib/utils";

/** Sizes of K1: the medium matchup shield and the 40 px one of the day groups and the plan strips. */
const SIZE = { medium: "size-[3.25rem]", small: "size-10", tiny: "size-8" } as const;

/** A team's real logo (a monogram only when it has none), named for assistive technology. */
export function TeamShield({ identity, size, className }: { identity: TeamIdentity; size: keyof typeof SIZE; className?: string }) {
  return <ClubShield name={identity.name} logoUrl={identity.logoUrl} decorative={false} className={cn(SIZE[size], className)} />;
}

/** The outline of a block that has no rival: the shield, empty. */
export function EmptyShield({ size, className }: { size: keyof typeof SIZE; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="phone-empty-shield"
      className={cn("inline-block shrink-0 rounded-b-[45%] rounded-t-md border-2 border-dashed border-muted-foreground", SIZE[size], className)}
    />
  );
}
