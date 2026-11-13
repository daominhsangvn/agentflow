import { describe, expect, it } from "vitest";
import { invitationPath } from "../invitation-path";

describe("invitationPath", () => {
  it("omits the query without a token", () => {
    expect(invitationPath("i1", null)).toBe("/invitations/i1");
  });

  it("adds the token", () => {
    expect(invitationPath("i1", "abc")).toBe("/invitations/i1?token=abc");
  });

  it("encodes the id and token", () => {
    expect(invitationPath("a/b", "x y&z")).toBe(
      "/invitations/a%2Fb?token=x+y%26z"
    );
  });
});
