"use client";

import {
  DEPLOYMENT_ID_HEADER,
  ORG_IDENTITY_HEADER,
} from "@repo/api/src/types/headers";
import { WORKFLOW_BUILDER_CHAT_PATH } from "@repo/api/src/types/workflow-builder";
import type { WorkflowBuilderChatRequest } from "@repo/api/src/types/workflow-builder-schemas";
import { useApiAdapter } from "@repo/app/shared/api/provider";
import { useAuthSnapshot } from "@repo/app/shared/auth/use-auth-snapshot";
import { useWaitForAuthLoaded } from "@repo/app/shared/auth/use-wait-for-auth-loaded";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useMemo } from "react";

type WorkflowBuilderTransportOptions = {
  workflowId: string | null;
  /** Read at send time, so every request carries the editor text of that moment. */
  getEditorYaml: () => string;
};

/**
 * The chat transport of the workflow builder assistant. It reaches the api
 * the way `useApiClient` does (origin, bearer token, organization and
 * deployment headers), but streams the response instead of reading an envelope.
 */
export function useWorkflowBuilderTransport({
  workflowId,
  getEditorYaml,
}: Readonly<WorkflowBuilderTransportOptions>) {
  const { getToken, orgId } = useAuthSnapshot();
  const waitForAuthLoaded = useWaitForAuthLoaded();
  const {
    resolveApiOrigin,
    fetch: injectedFetch,
    deploymentId,
  } = useApiAdapter();

  return useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: `${resolveApiOrigin()}${WORKFLOW_BUILDER_CHAT_PATH}`,
        ...(injectedFetch ? { fetch: injectedFetch } : {}),
        prepareSendMessagesRequest: async ({ messages }) => {
          await waitForAuthLoaded();
          const token = await getToken();
          const body: WorkflowBuilderChatRequest = {
            messages,
            editorYaml: getEditorYaml(),
            ...(workflowId ? { workflowId } : {}),
          };
          return {
            body,
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(orgId ? { [ORG_IDENTITY_HEADER]: orgId } : {}),
              ...(deploymentId ? { [DEPLOYMENT_ID_HEADER]: deploymentId } : {}),
            },
          };
        },
      }),
    [
      resolveApiOrigin,
      injectedFetch,
      deploymentId,
      getToken,
      orgId,
      waitForAuthLoaded,
      workflowId,
      getEditorYaml,
    ]
  );
}
