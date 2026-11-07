import { Badge } from "@/ui-v2/components/ui/badge";
import { PlayerProfileSectionV2 } from "./PlayerProfileSectionV2";

interface Props {
  traits: string[];
  title: string;
}

export default function PlayerProfileTraitsCardV2({ traits, title }: Props) {
  return (
    <PlayerProfileSectionV2 title={title}>
      <div className="flex flex-wrap gap-2">
        {traits.map((trait) => (
          <Badge key={trait} variant="secondary" className="h-6 px-2.5 text-xs">
            {trait}
          </Badge>
        ))}
      </div>
    </PlayerProfileSectionV2>
  );
}
