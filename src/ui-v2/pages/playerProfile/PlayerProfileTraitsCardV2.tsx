import { useTranslation } from "react-i18next";
import { Badge } from "@/ui-v2/components/ui/badge";
import { humanizeTraitId, traitLabelKey } from "@/lib/playerProfile/traits";
import { PlayerProfileSectionV2 } from "./PlayerProfileSectionV2";

interface Props {
  traits: string[];
  title: string;
}

export default function PlayerProfileTraitsCardV2({ traits, title }: Props) {
  const { t } = useTranslation();
  return (
    <PlayerProfileSectionV2 title={title}>
      <div className="flex flex-wrap gap-2">
        {traits.map((trait) => (
          <Badge key={trait} variant="secondary" className="h-6 px-2.5 text-xs">
            {t(traitLabelKey(trait), { defaultValue: humanizeTraitId(trait) })}
          </Badge>
        ))}
      </div>
    </PlayerProfileSectionV2>
  );
}
