import { describe, expect, it } from "vitest";

import es from "./es.json";

// The project's Spanish is neutral with "tú" forms. These are the voseo forms that were found in
// the file (stressed-last-syllable imperatives and "vos" present tense) plus "vos" itself and
// the regional "acá"; the list is not a grammar check.
const VOSEO_FORMS = [
  "vos",
  "acá",
  "abrí",
  "adquirí",
  "agregá",
  "ajustá",
  "aprovechá",
  "asegurá",
  "bajá",
  "buscá",
  "cancelá",
  "cerrá",
  "confirmá",
  "continuá",
  "definí",
  "elegí",
  "estrechá",
  "evitá",
  "forzá",
  "hacé",
  "ingresá",
  "intentá",
  "jugá",
  "mantené",
  "marcá",
  "mezclá",
  "negá",
  "necesitás",
  "ofrecé",
  "pasá",
  "perdés",
  "priorizá",
  "priorizás",
  "probá",
  "programá",
  "querés",
  "reducí",
  "respondés",
  "revisá",
  "seleccioná",
  "tenés",
  "usá",
  "volvé",
];

// The same file once addressed the reader as "usted" in about thirty message bodies. These are
// the formal imperatives, object pronouns and verb forms found there, as whole words. Plain
// "su" is not listed: it is usually third person ("su plantilla" of a rival), so the possessives
// were fixed by hand. Imperatives that double as third-person subjunctives ("que siga siendo")
// are only matched at the start of a sentence.
const USTED_FORMS = [
  "usted",
  "ustedes",
  "asegúrese",
  "prepárese",
  "manténgase",
  "tómese",
  "háganos",
  "indíquenos",
  "échele",
  "darle la bienvenida",
  "mantenerle informado",
  "le mantendré informado",
  "recordarle",
  "relevarle",
  "le recomendamos",
  "le deseamos",
  "le agradecemos",
  "le respalda",
  "cómo le gustaría",
  "cómo quiere manejarlo",
  "desea proceder",
  "se enfrenta a",
];
const USTED_SENTENCE_STARTS = ["revise", "estudie", "aproveche", "considere", "siga"];

function collectStrings(node: unknown, path: string, out: Array<[string, string]>) {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) collectStrings(value, path ? `${path}.${key}` : key, out);
  }
}

describe("es.json register", () => {
  it("uses neutral tú forms, never voseo", () => {
    const texts: Array<[string, string]> = [];
    collectStrings(es, "", texts);
    const letter = "A-Za-zÁÉÍÓÚáéíóúÑñ";
    const pattern = new RegExp(`(?<![${letter}])(${VOSEO_FORMS.join("|")})(?![${letter}])`, "i");
    const offenders = texts.filter(([, text]) => pattern.test(text)).map(([key, text]) => `${key}: ${pattern.exec(text)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it("uses tú forms, never the formal usted", () => {
    const texts: Array<[string, string]> = [];
    collectStrings(es, "", texts);
    const letter = "A-Za-zÁÉÍÓÚáéíóúÑñ";
    const forms = new RegExp(`(?<![${letter}])(${USTED_FORMS.join("|")})(?![${letter}])`, "i");
    const starts = new RegExp(`(?:^|[.!?¡¿—•:\\n])\\s*(${USTED_SENTENCE_STARTS.join("|")})(?![${letter}])`, "i");
    const offenders = texts
      .filter(([, text]) => forms.test(text) || starts.test(text))
      .map(([key, text]) => `${key}: ${(forms.exec(text) ?? starts.exec(text))?.[0].trim()}`);
    expect(offenders).toEqual([]);
  });
});
