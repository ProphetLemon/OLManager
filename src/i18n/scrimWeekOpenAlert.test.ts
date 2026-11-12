import { describe, expect, it } from "vitest";

import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import itLocale from "./locales/it.json";
import ptBR from "./locales/pt-BR.json";
import pt from "./locales/pt.json";
import tr from "./locales/tr.json";

type Tree = { dashboard: { alerts: { scrimWeekOpen: string } } };

const LOCALES = Object.entries({ en, es, fr, de, it: itLocale, pt, "pt-BR": ptBR, tr } as unknown as Record<string, Tree>);
const OLD_WORDING = /first scrim day|primer día de scrims|premier jour de scrims|ersten Scrim-Tag|primo giorno di scrim|primeiro dia de scrims|İlk scrim gününden/i;

describe("dashboard.alerts.scrimWeekOpen", () => {
  it.each(LOCALES)("%s does not tie the notice to the first scrim day", (_name, tree) => {
    expect(tree.dashboard.alerts.scrimWeekOpen).not.toMatch(OLD_WORDING);
  });

  it("reads for the days still ahead in en and es", () => {
    expect((en as unknown as Tree).dashboard.alerts.scrimWeekOpen).toBe(
      "This week's scrims are not planned yet. Plan the scrim days still ahead.",
    );
    expect((es as unknown as Tree).dashboard.alerts.scrimWeekOpen).toBe(
      "Los scrims de esta semana aún no están planificados. Planifica los días de scrims que aún quedan.",
    );
  });
});
