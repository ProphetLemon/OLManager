// Looks up a game player's Leaguepedia page to learn whether he retired or left his team.
import { fetchSectionHtml, fetchWikitext } from "./mediawiki-client.mjs";
import { isDisambiguation, parseInfobox, parseIntro, teamNameFromIntro } from "./leaguepedia-parse.mjs";
import { nameRelation } from "./text.mjs";

/**
 * @param {import("./mediawiki-client.mjs").MediaWikiClient} client
 * @param {{match_name:string, full_name:string}} player
 * @returns {Promise<{found:false}|{found:true,title:string,isRetired:boolean,state:string|null,teamText:string|null,teamName:string|null,birthDate:string|null}>}
 */
export async function lookupPlayerStatus(client, player) {
  const ign = player.match_name.trim();
  const titles = [...new Set([ign, `${ign} (${player.full_name.trim()})`])];
  for (const candidate of titles) {
    const { title, wikitext } = await fetchWikitext(client, candidate);
    if (!wikitext || isDisambiguation(wikitext)) continue;
    const infobox = parseInfobox(wikitext);
    if (!infobox) continue;
    // A page about somebody else with the same IGN must not decide this player's fate.
    if (nameRelation(infobox.name, player.full_name) === "conflict") continue;
    const intro = parseIntro(await fetchSectionHtml(client, title, 0));
    return {
      found: true,
      title,
      isRetired: infobox.isRetired || intro.state === "retired",
      state: intro.state,
      teamText: intro.teamText,
      teamName: teamNameFromIntro(intro.teamText),
      birthDate: infobox.birthDate,
    };
  }
  return { found: false };
}

/** Infobox data (birth date, canonical name) for a player who is new to the game. */
export async function lookupInfobox(client, page) {
  const { title, wikitext } = await fetchWikitext(client, page);
  if (!wikitext || isDisambiguation(wikitext)) return null;
  const infobox = parseInfobox(wikitext);
  return infobox ? { ...infobox, title } : null;
}
