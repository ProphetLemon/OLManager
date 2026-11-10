import { calcAge } from "@/lib/formatting/valueFormatting";
import type { StaffData } from "@/store/types";

/**
 * The birth date `data/staffs` gives every staff member that has one (all 189 of
 * them). It is a placeholder, not a real date, so it reads as "unknown". Staff age
 * feeds no game rule, so an unknown age is simply not shown.
 */
export const PLACEHOLDER_STAFF_BIRTH_DATE = "1990-01-01";

/** The staff member's age, or `null` when their birth date is missing or the placeholder. */
export function staffAge(staff: Pick<StaffData, "date_of_birth">, asOfDate: string): number | null {
  const dateOfBirth = staff.date_of_birth?.trim();
  if (!dateOfBirth || dateOfBirth === PLACEHOLDER_STAFF_BIRTH_DATE) return null;
  const age = calcAge(dateOfBirth, asOfDate);
  return age > 0 ? age : null;
}
