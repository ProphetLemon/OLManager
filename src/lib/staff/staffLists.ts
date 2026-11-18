import type { StaffData } from "@/store/types";

/** The club's staff, its owner included: the Staff tab's "My staff" view. */
export function clubStaff(staff: readonly StaffData[], teamId: string | null): StaffData[] {
  return staff.filter((s) => s.team_id === teamId);
}

/** Staff with no club, the Staff tab's "Available" view. Owners belong to their club and are never offered. */
export function availableStaff(staff: readonly StaffData[]): StaffData[] {
  return staff.filter((s) => !s.team_id && s.role !== "Owner");
}
