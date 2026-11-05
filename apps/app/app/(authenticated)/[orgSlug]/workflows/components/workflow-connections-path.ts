import { INTEGRATION_CONNECTIONS_ANCHOR } from "@repo/app/integrations/lib/integration-anchors";

/**
 * Org-relative link to the org Connections page (`/connections`), handed to the
 * workflow editor's "add a connection first" hints. The name predates the move
 * out of Settings and is kept for its callers.
 */
export const WORKFLOW_CONNECTIONS_SETTINGS_PATH = `/connections#${INTEGRATION_CONNECTIONS_ANCHOR}`;
