import { shortName } from "@/lib/match/live/championMarker";

import type { MarkerTexts } from "./useMarkerTexts";

export interface TagContentProps {
  name: string;
  texts: Pick<MarkerTexts, "sub" | "subCompact">;
  /**
   * Draws the words from `data-text` through `::before` instead of as text nodes. A probe has the
   * size of a real tag but adds no text to the page, for the page, for assistive technology and for
   * a search by text alike.
   */
  probe?: boolean;
}

function Words({ text, className, probe }: { text: string; className: string; probe: boolean }) {
  return probe ? (
    <span className={className} data-text={text} />
  ) : (
    <span className={className}>{text}</span>
  );
}

/**
 * What a tag says: the name, then the state. Both forms are in the markup and the CSS shows one,
 * by the form of the tag and by the width of the map, so a probe built from the same markup is
 * exactly as big as the tag it stands for.
 */
export function TagContent({ name, texts, probe = false }: TagContentProps) {
  return (
    <>
      <b>
        <Words text={name} className="arena-tag-long" probe={probe} />
        <Words text={shortName(name)} className="arena-tag-short" probe={probe} />
      </b>
      {texts.sub ? <Words text={texts.sub} className="arena-tag-sub arena-tag-long" probe={probe} /> : null}
      {texts.subCompact ? <Words text={texts.subCompact} className="arena-tag-sub arena-tag-short" probe={probe} /> : null}
    </>
  );
}
