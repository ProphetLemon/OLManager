import { useTranslation } from "react-i18next";
import { Badge } from "@/ui-v2/components/ui/badge";
import {
  humanizeTraitId,
  traitDescKey,
  traitLabelKey,
} from "@/lib/playerProfile/traits";
import { PlayerProfileSectionV2 } from "./PlayerProfileSectionV2";

interface Props {
  traits: string[];
  title: string;
}

/**
 * Each trait is its label plus what it does, written out: touch has no hover, so the description
 * is never left to a tooltip. A trait with no translated description shows the label alone.
 */
export default function PlayerProfileTraitsCardV2({ traits, title }: Props) {
  const { t } = useTranslation();
  return (
    <PlayerProfileSectionV2 title={title}>
      <ul className="flex flex-col gap-2">
        {traits.map((trait) => {
          const description = t(traitDescKey(trait), { defaultValue: "" });
          return (
            <li
              key={trait}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
            >
              <Badge variant="secondary" className="h-6 px-2.5 text-xs">
                {t(traitLabelKey(trait), {
                  defaultValue: humanizeTraitId(trait),
                })}
              </Badge>
              {description ? (
                <span className="min-w-0 flex-1 text-xs text-dim">
                  {description}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </PlayerProfileSectionV2>
  );
}
