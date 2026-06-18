import { describe, expect, it } from "vitest";
import { keepEndAtOrAfterStart } from "./timeRules";

describe("keepEndAtOrAfterStart", () => {
  it("moves an earlier end time to the selected start time", () => {
    expect(keepEndAtOrAfterStart("10:00", "09:30")).toBe("10:00");
  });

  it("keeps a valid later end time", () => {
    expect(keepEndAtOrAfterStart("09:00", "09:30")).toBe("09:30");
  });

  it("works for ISO date inputs as well", () => {
    expect(keepEndAtOrAfterStart("2026-06-15", "2026-06-14")).toBe("2026-06-15");
  });
});
