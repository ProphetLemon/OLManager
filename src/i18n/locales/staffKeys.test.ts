import { describe, expect, it } from "vitest";

import { STAFF_ERROR_REASONS } from "@/lib/staff/staffErrors";

import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import itLocale from "./it.json";
import ptBR from "./pt-BR.json";
import pt from "./pt.json";
import tr from "./tr.json";

type Staff = { clubOwner?: string; errors?: Record<string, string> };
const staffOf = (locale: unknown): Staff => (locale as { staff: Staff }).staff;

const OTHERS: Record<string, unknown> = { de, es, fr, it: itLocale, "pt-BR": ptBR, pt, tr };
const expectedKeys = ["generic", ...STAFF_ERROR_REASONS].sort();

describe("staff hire and release messages", () => {
  it("English has a message for every reason the backend can give, and the generic one", () => {
    expect(Object.keys(staffOf(en).errors ?? {}).sort()).toEqual(expectedKeys);
  });

  it.each(Object.entries(OTHERS))("%s translates the club owner label and every message", (_lang, locale) => {
    const staff = staffOf(locale);
    const english = staffOf(en);

    expect(staff.clubOwner).toBeTruthy();
    expect(staff.clubOwner).not.toBe(english.clubOwner);
    expect(Object.keys(staff.errors ?? {}).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(staff.errors?.[key], key).toBeTruthy();
      expect(staff.errors?.[key], key).not.toBe(english.errors?.[key]);
    }
  });
});
