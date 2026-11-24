// Events the pool takes on the owner's word, whatever the "official or seasonal" and "at least three tournaments" tests say.
// They are described by what their organisers write on the Leaguepedia page: Leaguepedia has no gender field, so nothing here says who a person is.
// To add an event, append an entry with its Leaguepedia `Tournaments.League` (every page of that league) or its `OverviewPage` (one page)
// and the page text or source that says what the event is for. Sources: OLManager-notes/research/women-events-2026-11-23.md, section 3.
export const LISTED_SINCE = "2023-06-01";

export const LISTED_EVENTS = Object.freeze([
  { league: "Equal Esports Cup", source: "page: hosted by Deutsche Telekom \"for all women and non-binary players\"" },
  { league: "Coupe des Étoiles", source: "page: \"France's largest League of Legends competition for women & marginalized genders\"" },
  { league: "League of Legends Game Changers", source: "page: \"women-only League of Legends competition series\" (N.E.O. and Riot Games)" },
  { league: "Nova Series", source: "page: \"first women-only League of Legends French tournament\" (Riot Games)" },
  { league: "Storm Takeover", source: "page: \"for all women and non-binary players\"" },
  { league: "La Faille", source: "page: \"reserved for women\"" },
  { league: "Café Cuties Cup", source: "page: \"open to all women\" (organiser Girls Girls - Women Play)" },
  { league: "Echoes of the Rift", source: "page: \"dedicated to women and marginalized genders\"" },
  { league: "League Impact Series", source: "page: \"a women and non-binary tournament hosted by Blue Otter\"" },
  { league: "MAGAMERS", source: "page: \"a female community tournament, organized by Circuito Tormenta\"" },
  // Only the Mexico City edition is verified; the league's other editions (2022-2023) are not on the list.
  { page: "GIRLGAMER 2024 Mexico City Festival", source: "page: \"a women's tournament based in Mexico City\"" },
  { league: "Liga Valkyria", source: "page: \"a Latin American female tournament\" (29 pages: LAN, LAS, Choque de Regiones)" },
  { league: "Defiance", source: "page: \"for players and staff of marginalized genders\"" },
  { league: "SheRivals", source: "page: a showmatch \"between two teams from the female and non-binary scene\"" },
]);

/**
 * Qualifier-flagged pages of the Goddess Tour (Ignis Cup 2024, Brazil) that pass the pool's filter because Leaguepedia flags the league
 * official, but that the qualifier cap would leave out (87, 76, 62 and 61 roster entries). The owner asked for them on 2026-11-23
 * (research, section 5, question 8). The cap is lifted for these pages and for nothing else.
 */
export const CAP_EXEMPT_PAGES = Object.freeze([
  "Ignis Cup 2024/Split 1/Goddess Tour 1",
  "Ignis Cup 2024/Split 1/Goddess Tour 2",
  "Ignis Cup 2024/Split 2/Goddess Tour 1",
  "Ignis Cup 2024/Split 3/Goddess Tour 2",
]);
