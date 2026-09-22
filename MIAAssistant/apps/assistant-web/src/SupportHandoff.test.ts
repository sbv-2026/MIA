import { describe, expect, it } from "vitest";
import { normalizedEmails } from "./SupportHandoff";

describe("support recipient emails", () => {
  it("normalizes and removes duplicate email chips", () => {
    expect(normalizedEmails([" User@Example.com ", "user@example.com", "audit@example.com"])).toEqual([
      "user@example.com",
      "audit@example.com",
    ]);
  });
});
