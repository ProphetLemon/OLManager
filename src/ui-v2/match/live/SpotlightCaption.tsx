import { useTranslation } from "react-i18next";

import type { Spotlight } from "@/lib/match/live/spotlight";
import { Button } from "@/ui-v2/components/ui/button";

import { MAX_CHIPS, SPOTLIGHT_KIND_KEYS, chipText, followingDetail, spotlightSentence } from "./spotlightText";
import "./liveMatch.css";

export interface SpotlightCaptionProps {
  spotlight: Spotlight;
  /** Called by "Stop following": the caption goes back to the automatic engagement. */
  onRelease?: () => void;
}

/**
 * The one sentence under the map: what matters most right now, with the other engagements as
 * chips. It is not a live region: the event feed is the one place that announces. The kind is
 * a word in a bordered chip, so no state rests on colour. When a player is followed, the
 * sentence is about that player and a button lets go.
 */
export function SpotlightCaption({ spotlight, onRelease }: SpotlightCaptionProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { headline } = spotlight;
  const shown = spotlight.chips.slice(0, MAX_CHIPS);
  const hidden = spotlight.chips.length - shown.length;
  const detail = followingDetail(headline, t);
  const followed = headline?.kind === "following" ? headline.params.champion : null;

  return (
    <section
      className="arena-spotlight"
      aria-label={t("onAir.match.spotlight.label")}
      data-kind={spotlight.kind}
      data-testid="spotlight-caption"
    >
      <div className="arena-sp-head">
        <span className="arena-sp-kind">{t(SPOTLIGHT_KIND_KEYS[spotlight.kind])}</span>
        <p className="arena-sp-line">{spotlightSentence(headline, t, locale)}</p>
        {detail ? <span className="arena-sp-detail">{detail}</span> : null}
      </div>
      {shown.length > 0 ? (
        <ul className="arena-sp-chips" aria-label={t("onAir.match.spotlight.others")}>
          {shown.map((chip) => (
            <li key={chip.id} className="arena-sp-chip" data-kind={chip.kind}>
              <span className="arena-sp-chip-kind">{t(SPOTLIGHT_KIND_KEYS[chip.kind])}</span>
              <span>{chipText(chip, t, locale)}</span>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="arena-sp-chip" data-kind="more">
              {t("onAir.match.spotlight.more", { count: hidden })}
            </li>
          ) : null}
        </ul>
      ) : null}
      {followed && onRelease ? (
        <Button type="button" variant="outline" className="arena-sp-release" onClick={() => onRelease()}>
          {t("onAir.match.spotlight.release", { name: followed.name })}
        </Button>
      ) : null}
    </section>
  );
}
