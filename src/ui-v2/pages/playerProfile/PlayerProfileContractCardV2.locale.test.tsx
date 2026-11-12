import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlayerProfileContractCardV2 from "./PlayerProfileContractCardV2";

const t = (key: string, options?: Record<string, string | number>) =>
  options?.date !== undefined ? `${key}|${options.date}` : key;

const base = {
  dateOfBirth: "2000-01-01",
  contractEnd: "2028-11-30",
  currentDate: "2027-02-01T00:00:00Z",
  condition: 80,
  fitness: 70,
  morale: 60,
  marketValue: 350000,
  wage: 12000,
  annualSuffix: "/yr",
  contractRiskLevel: "stable" as const,
  contractRiskLabel: "Stable",
  t,
};

describe("PlayerProfileContractCardV2 locale formatting", () => {
  it("writes the expiry date and the years left in Spanish", () => {
    render(<PlayerProfileContractCardV2 {...base} language="es" />);
    expect(screen.getByText("finances.contractExpiresOn|30 de noviembre de 2028")).toBeInTheDocument();
    expect(screen.getByText("1,8")).toBeInTheDocument();
    expect(screen.queryByText(/2028-11-30/)).toBeNull();
  });

  it("keeps the decimal point in English", () => {
    render(<PlayerProfileContractCardV2 {...base} language="en" />);
    expect(screen.getByText("1.8")).toBeInTheDocument();
  });
});
