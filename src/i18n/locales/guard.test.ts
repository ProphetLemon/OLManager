import { describe, expect, it as itTest } from "vitest";

import de from "../locales/de.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import itLocale from "../locales/it.json";
import ptBR from "../locales/pt-BR.json";
import pt from "../locales/pt.json";
import tr from "../locales/tr.json";

type LocaleTree = Record<string, unknown>;

const LOCALE_RESOURCES: Record<string, LocaleTree> = {
  de,
  en,
  es,
  fr,
  pt,
  "pt-BR": ptBR,
  tr,
  it: itLocale,
};

/**
 * Legitimate LoL role abbreviations - standard esports roles.
 * These are standard LoL positional abbreviations, NOT football (POR/DIF/CEN/ATT removed).
 */
const LOLEGITIMATE_ROLES = new Set([
  "TOP", "JGL", "JUNGLE", "MID", "ADC", "SUP", "SUPPORT", "BOT", "KL"
]);

/**
 * Extract only visible/translatable string values from locale.
 * Excludes technical keys (like "formation", "tactics", etc.) that are internal structure,
 * and only returns strings that would be shown to users.
 * Keys with very short values or that look like technical structure are excluded.
 */
function getAllVisibleStringEntries(obj: unknown, path = ""): Array<[string, string]> {
  if (typeof obj === "string") {
    // Exclude very short keys that are likely technical structure
    if (obj.length < 3) return [];
    return [[path, obj]];
  }
  if (Array.isArray(obj)) {
    return obj.flatMap((item, index) => getAllVisibleStringEntries(item, `${path}[${index}]`));
  }
  if (obj && typeof obj === "object") {
    return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
      getAllVisibleStringEntries(value, path ? `${path}.${key}` : key)
    );
  }
  return [];
}

/**
 * Build a Unicode-aware, case-insensitive whole-word matcher.
 * JS `\b` is ASCII-only, so accented/Turkish letters need explicit lookarounds.
 * Use `\p{L}*` inside `source` to allow inflected endings.
 */
function word(source: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, "iu");
}

/** Case-sensitive standalone "XI" (a football lineup); "Xi" or "xi" in prose must not match. */
const XI_CASE_SENSITIVE = /(?<![\p{L}\p{N}])XI(?![\p{L}\p{N}])/u;

/**
 * Prohibited football-specific terms per locale (all 8 locales).
 * Only football vocabulary: sport names, positions, match events, set pieces,
 * cards, match phases, venue/equipment and squad-size idioms. LoL-valid text
 * (roles, kills, objectives, game plan, Matchplan, Spielplan, Standards,
 * Defensive/Defansif stat labels) must NOT match. Ambiguous words are only
 * matched through specific phrases (e.g. tr "top" = ball -> "top sürme").
 */
const PROHIBITED_TERMS_BY_LOCALE: Record<string, RegExp[]> = {
  en: [
    word("football(?:er|ers)?|soccer"),
    word("goalkeepers?|goalies?|goalkeeping|strikers?|midfielders?|full-?backs?|wing-?backs?|centre-?backs?|center-?backs?|wingers?"),
    word("goals? scored|scored goals?|own goals?|hat-?tricks?|golden boot"),
    word("penalty (?:kicks?|takers?|shoot-?outs?|spot|area|box)|penalties taken|penalty conversion"),
    word("corner kicks?|free[- ]kicks?|set[- ]pieces?|throw-?ins?|goal kicks?"),
    word("clean sheets?|dribbling|tackling|offsides?"),
    word("(?:yellow|red) cards?"),
    word("half[ -]?time|full[ -]?time|final whistle|kick-?offs?|injury time|stoppage time"),
    word("stadiums?|footballs?|football pitch"),
    word("footedness|(?:left|right|weak)[- ]footed"),
    word("the lads|three points"),
    word("best XI|first XI|starting XI"),
    XI_CASE_SENSITIVE,
    word("formations?"),
    word("injur(?:y|ies|ed)"),
    word("go to the field"),
    word("shots?(?: on target)?|fouls?|possession|pass accuracy|clean sh|man of the match|scorers?|yellows|reds|goals?|corners?|match-?fit|(?:weak|strong) foot"),
  ],
  es: [
    word("fútbol|futbol|futbolistas?|soccer|football"),
    word("porter[oa]s?|delanteros?|centrocampistas?|mediocampistas?|guardameta"),
    word("goles? marcados?|goleador(?:es)?|goles? en propia|autogol(?:es)?|hat-?trick|bota de oro"),
    word("penalti(?:s)?|penal(?:es)?|lanzador de penaltis"),
    word("saques? de esquina|córners?|tiros? libres?|falta directa|balón parado|saques? de banda|saques? de puerta"),
    word("porter[ií]a a cero|portería imbatida|regates?|fuera de juego"),
    word("tarjetas? (?:amarillas?|rojas?)"),
    word("medio tiempo|tiempo completo|pitido final|saque inicial|tiempo añadido|tiempo de descuento"),
    word("campo de juego|césped|estadio(?! de la partida)|balón|pelota"),
    word("pierna (?:hábil|buena|mala)"),
    word("mejor XI|mejor once|once inicial|XI inicial|los chicos|tres puntos"),
    XI_CASE_SENSITIVE,
    word("formaci(?:ón|ones)"),
    word("lesi(?:ón|ones)|lesionad[oa]s?"),
    word("goles?"),
  ],
  fr: [
    word("football|footballeurs?|foot|soccer"),
    word("gardiens? de but|gardiens? fiables?|gardiens? des? buts|attaquants?|milieux? (?:de terrain|défensifs?|offensifs?)|arrières? latéra(?:l|ux)"),
    word("buts? marqués?|buteurs?|csc|contre son camp|triplé|soulier d'or"),
    word("penalt(?:y|ies|is)|tirs? au but|tireur de penalty"),
    word("corners?|coups? francs?|coup de pied arrêté|coups? de pied arrêtés|remises? en touche|rentrées? en touche|six mètres"),
    word("clean sheet|feuille blanche|dribbles?|dribbleurs?|tacles?|hors-?jeu"),
    word("cartons? (?:jaunes?|rouges?)"),
    word("mi-temps|temps plein|coup de sifflet final|coup d'envoi|arrêts de jeu|temps additionnel"),
    word("pelouse|terrain de jeu|stades? de football|ballon"),
    word("pied (?:fort|faible|gauche|droit)"),
    word("meilleur XI|onze (?:type|de départ|titulaire)|les gars|trois points"),
    XI_CASE_SENSITIVE,
    word("formations?"),
    word("blessures?|bless[ée]s?"),
    word("aller sur le terrain"),
  ],
  de: [
    word("fußball(?:er)?|fussball(?:er)?|soccer|football"),
    word("torh(?:ü|ue)ter\\p{L}*|torwart\\p{L}*|stürmer\\p{L}*|mittelfeld\\p{L}*|verteidiger\\p{L}*|außenverteidiger\\p{L}*|flügelspieler\\p{L}*"),
    word("tore? geschossen|geschossene tore|eigentor\\p{L}*|hattrick|torjäger\\p{L}*|torschütze\\p{L}*|goldener schuh|torhüterleistung"),
    word("elfmeter\\p{L}*|strafstoß\\p{L}*|elfmeterschütze\\p{L}*|elfmeterschießen"),
    word("eckbälle?|eckstoß\\p{L}*|freistoß\\p{L}*|freistöße|standardsituation\\p{L}*|abstoß"),
    word("zu null|dribbling\\p{L}*|tackling\\p{L}*|zweikampf\\p{L}*|abseits"),
    word("gelbe[nr]? karten?|rote[nr]? karten?"),
    word("halbzeit\\p{L}*|vollzeit|schlusspfiff|anstoß|nachspielzeit"),
    word("spielfeld|rasen|stadion\\p{L}*|fußball\\p{L}*|ball"),
    word("starker fuß|schwacher fuß|linksfüßig|rechtsfüßig|beidfüßig"),
    word("beste[nr]? XI|startelf|die jungs|drei punkte"),
    XI_CASE_SENSITIVE,
    word("formation(?:en)?"),
    word("verletz\\p{L}*"),
    word("aufs? feld|auf den platz"),
    word("ballbesitz"),
  ],
  it: [
    word("calcio|calciatori?|calcistic\\p{L}*|football|soccer"),
    word("portier[ei]|portiere|attaccanti?|centrocampisti?|difensori|terzin[oi]"),
    word("gol segnati|reti segnate|marcatori|autogol|tripletta|scarpa d'oro|capocannoniere"),
    word("rigor(?:e|i|ista|isti)|calcio di rigore|calci di rigore"),
    word("calci? d'angolo|corner|calci? di punizione|punizioni|calci? piazzati|palle inattive|rimesse? laterali?"),
    word("porta inviolata|clean sheet|dribbling|contrasti?|tackle|fuorigioco"),
    word("cartellin[oi] (?:giall[oi]|ross[oi])"),
    word("intervallo|primo tempo|secondo tempo|fischio finale|calcio d'inizio|tempo pieno"),
    word("campo da gioco|terreno di gioco|stadio(?! iniziale| finale| avanzato)|pallone|prato"),
    word("piede (?:forte|debole|destro|sinistro)"),
    word("miglior XI|miglior undici|undici titolari|undici iniziale|i ragazzi|tre punti"),
    XI_CASE_SENSITIVE,
    word("formazione tipo|4-4-2"),
    word("infortuni\\p{L}*|infortunat\\p{L}*"),
    word("vai in campo"),
    word("possesso palla"),
  ],
  "pt-BR": [
    word("futebol|futebolistas?|soccer|football"),
    word("goleiros?|atacantes?|meio-?campistas?|zagueiros?"),
    word("gols? marcados?|gols? sofridos?|artilheiros?|gols? contra|hat-?trick|chuteira de ouro|bola de ouro"),
    word("p[êe]naltis?|p[êe]naltis|cobran[çc]as? de p[êe]nalti"),
    word("escanteios?|tiros? livres?|faltas? diretas?|bolas? paradas?|laterais? arremessos?|arremessos? laterais?|tiros? de meta"),
    word("n[ãa]o sofrer gols|jogo sem sofrer gols|drible\\p{L}*|desarmes?|impedimentos?"),
    word("cart(?:ão|ões) (?:amarelos?|vermelhos?)"),
    word("(?:no|ao|do|de) intervalo|primeiro tempo|segundo tempo|apito final|pontapé inicial|acréscimos|tempo integral"),
    word("campo de jogo|gramado|est[áa]dios?|posse de bola"),
    word("p[ée] (?:forte|fraco|esquerdo|direito)"),
    word("melhor XI|melhor onze|onze inicial|onze titular|os caras|três pontos"),
    XI_CASE_SENSITIVE,
    word("forma[çc](?:ão|ões)"),
    word("les(?:ão|ões)|lesionad\\p{L}*"),
    word("ir para o campo"),
    word("gols?"),
  ],
  pt: [
    word("futebol|futebolistas?|soccer|football"),
    word("guarda-?redes|goleiros?|avançados?|pontas?-?de-?lança"),
    word("golos? marcados?|golos? sofridos?|golos?|marcadores?|autogolos?|hat-?trick|bota de ouro"),
    word("grande penalidade|penaltis?|pénaltis?|penalidades? máximas?|marcador de penáltis?"),
    word("pontapés? de canto|cobrança de canto|livres? diretos?|bolas? paradas?|lançamentos? laterais|pontapés? de baliza|pontapé de saída"),
    word("baliza inviolada|drible\\p{L}*|desarmes?|foras? de jogo|fora-?de-?jogo"),
    word("cart(?:ão|ões) (?:amarelos?|vermelhos?)"),
    word("(?:no|ao|do|de) intervalo|primeira parte|segunda parte|apito final|tempo regulamentar|descontos|tempo inteiro"),
    word("relvado|campo de jogo|est[áa]dios?|posse de bola"),
    word("p[ée] (?:forte|fraco|esquerdo|direito)"),
    word("melhor XI|melhor onze|onze inicial|onze titular|os rapazes|três pontos"),
    XI_CASE_SENSITIVE,
    word("forma[çc](?:ão|ões)"),
    word("les(?:ão|ões)|lesionad\\p{L}*"),
    word("ir para o campo"),
    word("remates?"),
  ],
  tr: [
    word("futbol\\p{L}*|futbolcu\\p{L}*|football|soccer"),
    word("kaleci\\p{L}*|forvet\\p{L}*|santrfor\\p{L}*|orta saha\\p{L}*|defans\\p{L}* oyuncu\\p{L}*"),
    word("atılan goller|attığı gol\\p{L}*|gol attı\\p{L}*|gol kral\\p{L}*|kendi kalesine|hat-?trick|altın ayakkabı"),
    word("penalt[ıi]\\p{L}*|penaltı kullan\\p{L}*"),
    word("korner\\p{L}*|serbest vuruş\\p{L}*|duran top\\p{L}*|taç atış\\p{L}*|aut atış\\p{L}*|kale vuruş\\p{L}*"),
    word("gol yemeden|kalesini gole kapat\\p{L}*|top sürme\\p{L}*|dripling\\p{L}*|kayma müdahale\\p{L}*|ofsayt\\p{L}*"),
    word("(?:sarı|kırmızı) kart\\p{L}*"),
    word("devre arası|ilk yarı|ikinci yarı|son düdük|maç sonu düdüğü|başlama vuruşu|uzatma süresi"),
    word("futbol sahası|sahada oynan\\p{L}*|saha zemini|çim zemin|stadyum\\p{L}*|futbol topu"),
    word("güçlü ayak|zayıf ayak|sağ ayak|sol ayak"),
    word("en iyi 11|ilk 11|İlk 11|ilk onbir|ilk 11'i|üç puan"),
    word("diziliş\\p{L}*"),
    word("sakat\\p{L}*"),
    word("sahaya (?:çık|git)\\p{L}*"),
    word("şutlar?"),
  ],
};

/** Returns the source of every prohibited pattern that matches `value`. */
function findFootballHits(locale: string, value: string): string[] {
  const patterns = PROHIBITED_TERMS_BY_LOCALE[locale] ?? [];
  return patterns.filter((pattern) => pattern.test(value)).map((pattern) => pattern.toString());
}

describe("i18n locale football guard", () => {
  for (const [localeCode, localeData] of Object.entries(LOCALE_RESOURCES)) {
    if (!localeData) continue;

    itTest(`should not contain prohibited football terms in ${localeCode}`, () => {
      const entries = getAllVisibleStringEntries(localeData);
      const failures: string[] = [];

      for (const [path, value] of entries) {
        if (!value || typeof value !== "string" || value.length < 3) continue;
        if (LOLEGITIMATE_ROLES.has(value.toUpperCase())) continue;

        for (const pattern of findFootballHits(localeCode, value)) {
          failures.push(`${path}: "${value.substring(0, 60)}${value.length > 60 ? "..." : ""}" [${pattern}]`);
        }
      }

      expect(failures.length, `Failures in ${localeCode}:\n${failures.join('\n')}`).toBe(0);
    });
  }
});

describe("i18n football matcher self-test", () => {
  const FOOTBALL_SAMPLES: Array<[string, string]> = [
    ["en", "Golden Boot"],
    ["en", "Final whistle"],
    ["en", "Waiting for kick-off..."],
    ["en", "Great work, the lads delivered"],
    ["en", "Goalkeeper"],
    ["en", "Left-footed striker"],
    ["es", "Portero fiable"],
    ["es", "Tarjetas Amarillas"],
    ["es", "Balón parado"],
    ["fr", "Gardien fiable"],
    ["fr", "Cartons Jaunes"],
    ["fr", "Coup d'envoi"],
    ["de", "Elfmeterschütze"],
    ["de", "Gelbe Karten"],
    ["de", "Torhüter"],
    ["it", "Rigorista"],
    ["it", "Calci d'angolo"],
    ["it", "Portiere affidabile"],
    ["pt-BR", "Goleiro confiável"],
    ["pt-BR", "Cartões Amarelos"],
    ["pt-BR", "Escanteios"],
    ["pt", "Golos"],
    ["pt", "Guarda-redes fiável"],
    ["pt", "Pontapé de saída"],
    ["tr", "Kaleci"],
    ["tr", "Duran top"],
    ["tr", "Top sürme"],
    ["tr", "Sarı Kart"],
    ["en", "Full time: 2 - 1"],
    ["en", "Half time"],
    ["en", "Choose a preferred formation"],
    ["en", "Injured"],
    ["en", "Go to the Field"],
    ["es", "Lesión"],
    ["fr", "Aller sur le Terrain"],
    ["tr", "Sakatlık"],
    ["de", "Verletzung"],
    ["it", "Vai in campo"],
  ];

  const LOL_SAMPLES: Array<[string, string]> = [
    ...["en", "es", "fr", "de", "it", "pt-BR", "pt", "tr"].flatMap((locale): Array<[string, string]> => [
      [locale, "Kill Leader"],
      [locale, "Top"],
      [locale, "Jungle"],
      [locale, "Baron"],
    ]),
    ["en", "game plan"],
    ["en", "Defensive"],
    ["es", "Plan de juego"],
    ["es", "Descanso"],
    ["de", "Matchplan"],
    ["de", "Spielplan"],
    ["de", "Standards"],
    ["fr", "Plan de jeu"],
    ["fr", "Voie du milieu"],
    ["tr", "Defansif"],
    ["tr", "top lane"],
    ["tr", "Bekleyen Teklifler"],
    ["it", "Piano di gioco"],
    ["it", "Reset mentale / recupero"],
    ["pt", "Plano de jogo"],
    ["pt", "Aproveita este intervalo para avaliar o teu plantel."],
    ["pt-BR", "Plano de jogo"],
    ["en", "Pitch a draft idea to the board"],
    ["en", "Season Xi"],
    ["en", "Tackle the objective"],
    ["fr", "Gardien de la Faille"],
    ["fr", "Stade précoce"],
    ["pt", "Cantos do mapa"],
    ["tr", "Sahada görüş"],
  ];

  for (const [locale, value] of FOOTBALL_SAMPLES) {
    itTest(`flags football text in ${locale}: ${value}`, () => {
      expect(findFootballHits(locale, value).length).toBeGreaterThan(0);
    });
  }

  for (const [locale, value] of LOL_SAMPLES) {
    itTest(`does not flag LoL text in ${locale}: ${value}`, () => {
      expect(findFootballHits(locale, value)).toEqual([]);
    });
  }

  itTest("covers every locale with at least one pattern", () => {
    for (const locale of Object.keys(LOCALE_RESOURCES)) {
      expect(PROHIBITED_TERMS_BY_LOCALE[locale]?.length, locale).toBeGreaterThan(0);
    }
  });
});

function getValueByPath(localeData: LocaleTree, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, localeData);
}

describe("finance ledger locale parity", () => {
  const financeLedgerKeys = [
    "finances.ledgerSearchLabel",
    "finances.ledgerSearchPlaceholder",
    "finances.ledgerKindFilter",
    "finances.ledgerSourceFilter",
    "finances.ledgerAllKinds",
    "finances.ledgerAllSources",
    "finances.ledgerRunningBalance",
    "finances.ledgerNoMatches",
    "finances.ledgerSource.legacy",
    "finances.ledgerSource.monthly",
    "finances.ledgerSource.transfer",
    "finances.ledgerSource.staff",
    "finances.ledgerSource.academy",
    "finances.ledgerSource.facility",
    "finances.ledgerSource.sponsor",
    "finances.ledgerSource.prize",
    "finances.ledgerSource.board",
    "finances.ledgerSource.manual",
    "be.msg.finance.sponsorAccepted.subject",
    "be.msg.finance.sponsorAccepted.body",
    "be.msg.finance.sponsorPayout.subject",
    "be.msg.finance.sponsorPayout.body",
    "be.msg.finance.sponsorBonus.subject",
    "be.msg.finance.sponsorBonus.body",
    "be.msg.finance.sponsorExpired.subject",
    "be.msg.finance.sponsorExpired.body",
    "be.msg.finance.facilityUpkeepSummary.subject",
    "be.msg.finance.facilityUpkeepSummary.body",
    "be.msg.finance.facilityUpkeepSpike.subject",
    "be.msg.finance.facilityUpkeepSpike.body",
    "be.msg.finance.prizePayout.subject",
    "be.msg.finance.prizePayout.body",
    "be.msg.finance.boardFinancialHealth.subject",
    "be.msg.finance.boardFinancialHealth.body",
  ];

  for (const [localeCode, localeData] of Object.entries(LOCALE_RESOURCES)) {
    itTest(`includes finance ledger keys in ${localeCode}`, () => {
      const missing = financeLedgerKeys.filter((key) => typeof getValueByPath(localeData, key) !== "string");

      expect(missing, `Missing finance ledger keys in ${localeCode}`).toEqual([]);
    });
  }

  itTest("uses monthsLeft, not weeksLeft, for finance warning interpolation", () => {
    for (const [localeCode, localeData] of Object.entries(LOCALE_RESOURCES)) {
      const body = getValueByPath(localeData, "be.msg.financeWarning.body");

      expect(body, `financeWarning body missing in ${localeCode}`).toEqual(expect.any(String));
      expect(body as string, `financeWarning should interpolate monthsLeft in ${localeCode}`).toContain("{{monthsLeft}}");
      expect(body as string, `financeWarning should not interpolate weeksLeft in ${localeCode}`).not.toContain("{{weeksLeft}}");
    }
  });
});
