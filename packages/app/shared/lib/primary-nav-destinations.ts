/**
 * Canonical, ordered list of the app's primary navigation destinations —
 * the single source of truth shared by the web app's desktop-width sidebar
 * (`apps/app/(authenticated)/components/sidebar.tsx`, also consumed by that
 * app's command palette) and the mobile bottom nav
 * (`shared/components/mobile-bottom-nav.tsx`).
 *
 * Scope: this list backs the `apps/app` (web) shell only. The Electron desktop
 * renderer has its own navigation registry (`apps/desktop/src/renderer/
 * navigation/nav-config.ts` + `route-table.ts`) and does NOT consume this list,
 * so "desktop" here means the web app's desktop-width sidebar, never the
 * Electron shell.
 *
 * Both consuming surfaces derive their destination set from this list so that
 * adding a top-level destination here reaches both navs at once, and they stay
 * in the same order and flag-gating without hand-maintained parallel copies.
 * The sidebar renders the full list, split into its own visual groups. The
 * mobile bar renders an EXPLICIT named subset of these
 * ({@link MOBILE_NAV_PHONE_DESTINATION_PATHS} via
 * {@link resolveMobileNavDestinations}), not a prefix slice — so its shape does
 * not shift with flag state (FEA-4155); everything else stays reachable from the
 * sidebar Sheet its menu affordance opens.
 *
 * `path` is org-relative (no `/${orgSlug}` prefix) so each surface can resolve
 * it through its own org-path builder — the mobile nav via the navigation
 * port's `useOrgPath`, the sidebar by prefixing `/${orgSlug}`.
 */

import {
  BotIcon,
  HistoryIcon,
  HomeIcon,
  InboxIcon,
  type LucideIcon,
  PlugIcon,
  ZapIcon,
} from "lucide-react";

/**
 * Which visual group a destination belongs to in the web app's desktop-width
 * sidebar. The mobile nav ignores grouping and renders a flat, capped row; the
 * sidebar uses it to render Home, then "Work", then "Setup".
 */
export const PrimaryNavGroup = {
  Home: "home",
  Work: "work",
  Setup: "setup",
} as const;
export type PrimaryNavGroup =
  (typeof PrimaryNavGroup)[keyof typeof PrimaryNavGroup];

/** Org-relative path of Home. Home keeps the old Dashboard URL (user decision). */
export const HOME_NAV_PATH = "/dashboard";

/** Org-relative path of the org-wide Cases page. */
export const CASES_NAV_PATH = "/cases";

/** Org-relative path of the org-wide process-mode Runs page. */
export const RUNS_NAV_PATH = "/runs";

/** Org-relative path of the Sessions destination. */
export const SESSIONS_NAV_PATH = "/sessions";

/** Org-relative path of the org Connections page. */
export const CONNECTIONS_NAV_PATH = "/connections";

/** Org-relative path of the Skills catalog (the old agent-components catalog, a Labs item). */
export const SKILLS_CATALOG_NAV_PATH = "/skills";

/**
 * Org-relative path of the Agents destination: the org's agents (compute
 * targets). No badge; the sidebar keys off `NavId.Agents` for stable identity.
 */
export const AGENTS_NAV_PATH = "/agents";

/** Org-relative path of the Workflows destination (event-driven agent runs). */
export const WORKFLOWS_NAV_PATH = "/workflows";

export type PrimaryNavDestination = {
  /** Visible label and accessible destination name. */
  title: string;
  /** Org-relative path (no leading `/${orgSlug}`), resolved per surface. */
  path: string;
  icon: LucideIcon;
  /** Sidebar grouping; the mobile nav renders the flat ordered list. */
  group: PrimaryNavGroup;
  /**
   * PostHog/desktop feature-flag key gating this destination. Omitted means
   * always-on. Both surfaces resolve it through their feature-flag port so a
   * flagged-off route never surfaces a dead-ending nav item.
   */
  featureFlag?: string;
};

/**
 * The ordered destinations. Order is authoritative for the sidebar, which
 * renders every entry in this order within its groups. The mobile nav renders
 * an explicit named subset instead (see {@link MOBILE_NAV_PHONE_DESTINATION_PATHS}).
 */
export const PRIMARY_NAV_DESTINATIONS: readonly PrimaryNavDestination[] = [
  {
    title: "Home",
    path: HOME_NAV_PATH,
    icon: HomeIcon,
    group: PrimaryNavGroup.Home,
  },
  {
    title: "Cases",
    path: CASES_NAV_PATH,
    icon: InboxIcon,
    group: PrimaryNavGroup.Work,
  },
  {
    title: "Sessions",
    path: SESSIONS_NAV_PATH,
    icon: HistoryIcon,
    group: PrimaryNavGroup.Work,
  },
  {
    title: "Workflows",
    path: WORKFLOWS_NAV_PATH,
    icon: ZapIcon,
    group: PrimaryNavGroup.Setup,
  },
  {
    title: "Agents",
    path: AGENTS_NAV_PATH,
    icon: BotIcon,
    group: PrimaryNavGroup.Setup,
  },
  {
    title: "Connections",
    path: CONNECTIONS_NAV_PATH,
    icon: PlugIcon,
    group: PrimaryNavGroup.Setup,
  },
  // My Tasks, Documents, Issues, Routines, Inbox, Branches and Runs (hidden
  // while the orchestrator is the focus) routes still exist for direct links;
  // they are not in the menu.
] as const;

/**
 * Maximum destination slots the mobile bottom nav renders inline before the
 * menu affordance. Native bottom navs cap at five total slots; the menu is
 * always the fifth, so at most four destinations render inline and any
 * overflow stays reachable from the sidebar Sheet the menu opens.
 */
export const MOBILE_NAV_MAX_DESTINATIONS = 4;

/**
 * The exact org-relative paths the mobile bottom nav renders inline, in order:
 * Home, Cases, Sessions and Agents (4 = {@link MOBILE_NAV_MAX_DESTINATIONS}).
 * Naming them explicitly keeps the bar shape independent of flag state; the
 * rest stays reachable from the sidebar Sheet the menu affordance opens.
 */
export const MOBILE_NAV_PHONE_DESTINATION_PATHS: readonly string[] = [
  HOME_NAV_PATH,
  CASES_NAV_PATH,
  SESSIONS_NAV_PATH,
  AGENTS_NAV_PATH,
] as const;

/**
 * The ordered mobile-bottom-nav destinations: the named phone set
 * ({@link MOBILE_NAV_PHONE_DESTINATION_PATHS}) resolved against the canonical
 * registry so title/icon/flag stay single-sourced, filtered by the injected
 * feature-flag state, and capped at {@link MOBILE_NAV_MAX_DESTINATIONS}.
 * `flagState` maps a destination's `featureFlag` key to its resolved enabled
 * boolean; a destination with no `featureFlag` is always included.
 */
export function resolveMobileNavDestinations(
  flagState: Record<string, boolean>
): PrimaryNavDestination[] {
  const byPath = new Map(
    PRIMARY_NAV_DESTINATIONS.map((destination) => [
      destination.path,
      destination,
    ])
  );
  const resolved: PrimaryNavDestination[] = [];
  for (const path of MOBILE_NAV_PHONE_DESTINATION_PATHS) {
    const destination = byPath.get(path);
    if (!destination) {
      continue;
    }
    if (destination.featureFlag && !flagState[destination.featureFlag]) {
      continue;
    }
    resolved.push(destination);
    if (resolved.length === MOBILE_NAV_MAX_DESTINATIONS) {
      break;
    }
  }
  return resolved;
}
