import { describe, expect, it } from "vitest";
import {
  AGENTS_NAV_PATH,
  CASES_NAV_PATH,
  CONNECTIONS_NAV_PATH,
  HOME_NAV_PATH,
  MOBILE_NAV_PHONE_DESTINATION_PATHS,
  PRIMARY_NAV_DESTINATIONS,
  PrimaryNavGroup,
  resolveMobileNavDestinations,
  SESSIONS_NAV_PATH,
  WORKFLOWS_NAV_PATH,
} from "../primary-nav-destinations";

const paths = PRIMARY_NAV_DESTINATIONS.map((destination) => destination.path);

describe("PRIMARY_NAV_DESTINATIONS", () => {
  it("lists Home, Work and Setup destinations in order", () => {
    expect(paths).toEqual([
      HOME_NAV_PATH,
      CASES_NAV_PATH,
      SESSIONS_NAV_PATH,
      WORKFLOWS_NAV_PATH,
      AGENTS_NAV_PATH,
      CONNECTIONS_NAV_PATH,
    ]);
    expect(PRIMARY_NAV_DESTINATIONS.map((d) => d.group)).toEqual([
      PrimaryNavGroup.Home,
      PrimaryNavGroup.Work,
      PrimaryNavGroup.Work,
      PrimaryNavGroup.Setup,
      PrimaryNavGroup.Setup,
      PrimaryNavGroup.Setup,
    ]);
  });

  it("puts Home first at the dashboard URL", () => {
    expect(HOME_NAV_PATH).toBe("/dashboard");
    expect(PRIMARY_NAV_DESTINATIONS[0].title).toBe("Home");
    expect(PRIMARY_NAV_DESTINATIONS[0].path).toBe(HOME_NAV_PATH);
  });

  it("has no feature-flagged destination", () => {
    expect(
      PRIMARY_NAV_DESTINATIONS.some((destination) => destination.featureFlag)
    ).toBe(false);
  });

  it("keeps every destination path unique", () => {
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("drops the removed destinations", () => {
    for (const removed of ["/my-tasks", "/documents", "/issues", "/routines"]) {
      expect(paths).not.toContain(removed);
    }
  });
});

describe("mobile destinations", () => {
  it("is Home, Cases, Sessions and Agents, all in the registry", () => {
    expect(MOBILE_NAV_PHONE_DESTINATION_PATHS).toEqual([
      HOME_NAV_PATH,
      CASES_NAV_PATH,
      SESSIONS_NAV_PATH,
      AGENTS_NAV_PATH,
    ]);
    for (const path of MOBILE_NAV_PHONE_DESTINATION_PATHS) {
      expect(paths).toContain(path);
    }
    expect(
      resolveMobileNavDestinations({}).map((destination) => destination.path)
    ).toEqual([...MOBILE_NAV_PHONE_DESTINATION_PATHS]);
  });
});
