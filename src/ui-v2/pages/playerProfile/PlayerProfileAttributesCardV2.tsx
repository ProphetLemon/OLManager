import { Shield } from "lucide-react";
import { getAttributeColorClass } from "@/lib/playerProfile/helpers";
import type { PlayerAttributeGroup } from "@/lib/playerProfile/attributes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

interface PlayerProfileAttributesCardV2Props {
  attrGroups: PlayerAttributeGroup[];
  canViewAttributes: boolean;
  title: string;
  averageLabel?: string;
  hiddenTitle: string;
  hiddenBody: string;
}

export default function PlayerProfileAttributesCardV2({
  attrGroups,
  canViewAttributes,
  title,
  hiddenTitle,
  hiddenBody,
}: PlayerProfileAttributesCardV2Props) {
  const maxAttrs = Math.max(...attrGroups.map((g) => g.attrs.length));

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {canViewAttributes ? (
          <div className="flex flex-col gap-4">
            {/* Headers row */}
            <div className="grid grid-cols-3 gap-5">
              {attrGroups.map((group) => (
                <h4 key={group.label} className="border-b border-border/60 pb-1.5 font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h4>
              ))}
            </div>

            {/* Attribute rows — synced across columns by index */}
            {Array.from({ length: maxAttrs }).map((_, rowIdx) => (
              <div key={rowIdx} className="grid grid-cols-3 gap-5">
                {attrGroups.map((group) => {
                  const attr = group.attrs[rowIdx];
                  return (
                    <div key={group.label + rowIdx} className="flex items-center gap-2 min-h-8">
                      {attr ? (
                        <>
                          <span className="w-[88px] shrink-0 text-xs text-muted-foreground/70 leading-tight">{attr.name}</span>
                          {attr.value !== null ? (
                            <>
                              <div className="relative h-2 flex-1 overflow-hidden rounded-full">
                                <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #f59e0b, #22c55e)' }} />
                                <div
                                  className="absolute inset-y-0 right-0 bg-muted transition-all duration-500"
                                  style={{ width: `${100 - attr.value}%` }}
                                />
                              </div>
                              <span className={cn("w-7 shrink-0 text-right font-heading text-xs font-bold tabular-nums", getAttributeColorClass(attr.value))}>
                                {attr.value}
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div className="h-full w-1/3 rounded-full bg-muted-foreground/20" />
                              </div>
                              <span className="w-7 shrink-0 text-right font-heading text-xs font-bold tabular-nums text-muted-foreground/70">??</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground/30">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
              <Shield className="size-7 text-muted-foreground/70" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{hiddenTitle}</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground/70">{hiddenBody}</p>
            <div className="mt-6 flex flex-col gap-4 text-left">
              {/* Headers row */}
              <div className="grid grid-cols-3 gap-5">
                {attrGroups.map((group) => (
                  <h4 key={group.label} className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                    {group.label}
                  </h4>
                ))}
              </div>

              {Array.from({ length: maxAttrs }).map((_, rowIdx) => (
                <div key={rowIdx} className="grid grid-cols-3 gap-5">
                  {attrGroups.map((group) => {
                    const attr = group.attrs[rowIdx];
                    return (
                      <div key={group.label + rowIdx} className="flex items-center gap-3 min-h-8">
                        {attr ? (
                          <>
                            <span className="w-24 shrink-0 text-xs text-muted-foreground/70 leading-tight">{attr.name}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full w-1/3 rounded-full bg-muted-foreground/20" />
                            </div>
                            <span className="w-6 shrink-0 text-right text-xs text-muted-foreground/70">??</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/30">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
