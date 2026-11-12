// Ability archetypes of every champion, from the committed kits file and a curated overrides file.
//
//   node scripts/game-data/abilities.mjs [--kits <file>] [--curated <file>] [--out <file>] [--check]
//
// Writes assets/simulation/champion-abilities.v1.json. No network: the inputs are assets/simulation/champion-kits.v1.json
// and scripts/game-data/ability-archetypes.curated.json. `--check` writes nothing and fails when the file on disk differs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAbilities } from "./lib/ability-archetypes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const HELP = `Usage: node scripts/game-data/abilities.mjs [flags]

  --kits <file>      champion kits (default assets/simulation/champion-kits.v1.json)
  --curated <file>   curated overrides (default scripts/game-data/ability-archetypes.curated.json)
  --out <file>       output (default assets/simulation/champion-abilities.v1.json)
  --check            write nothing; exit 1 when the output file differs from what would be written
  -h, --help         show this help
`;

export function parseArgs(argv) {
  const args = {
    kits: path.join(root, "assets/simulation/champion-kits.v1.json"),
    curated: path.join(root, "scripts/game-data/ability-archetypes.curated.json"),
    out: path.join(root, "assets/simulation/champion-abilities.v1.json"),
    check: false,
    help: false,
  };
  const value = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith("--")) throw new Error(`${flag} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--check") args.check = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--kits") args.kits = path.resolve(value(++i, flag));
    else if (flag === "--curated") args.curated = path.resolve(value(++i, flag));
    else if (flag === "--out") args.out = path.resolve(value(++i, flag));
    else throw new Error(`unknown flag ${flag}`);
  }
  return args;
}

/** The exact text of the output file for the given inputs, plus the counts. */
export function render(kits, curated) {
  const { file, report } = buildAbilities({ kits, curated });
  return { text: `${JSON.stringify(file, null, 2)}\n`, report };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  const log = (message) => console.error(`[abilities] ${message}`);
  const kits = JSON.parse(fs.readFileSync(args.kits, "utf8"));
  const curated = JSON.parse(fs.readFileSync(args.curated, "utf8"));
  const { text, report } = render(kits, curated);
  log(`champions ${report.champions}, abilities ${report.abilities}: ${report.ruleOnly} from the rules alone, ${report.curated} curated`);
  log(`champions per archetype: ${Object.entries(report.championsPerArchetype).map(([name, count]) => `${name} ${count}`).join(", ")}`);
  log(`abilities per damage kind: ${Object.entries(report.abilitiesPerDamageKind).map(([name, count]) => `${name} ${count}`).join(", ")}`);
  if (args.check) {
    const onDisk = fs.existsSync(args.out) ? fs.readFileSync(args.out, "utf8") : null;
    if (onDisk !== text) throw new Error(`${args.out} is out of date; run node scripts/game-data/abilities.mjs`);
    log("output file is up to date");
    return;
  }
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, text);
  log(`wrote ${path.relative(root, args.out)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[abilities] ${error.message}`);
    process.exitCode = 1;
  }
}
