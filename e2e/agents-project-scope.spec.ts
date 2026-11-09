/**
 * A project's Agents decide where its workflows run, and the Agents tab reads
 * them (docs/orchestrator.md, docs/runner.md). Real API and database, no
 * stubs: personal Agent registration, Project → Agents, workflow save,
 * launch and GET /workflows/{id}/agents. A case needs a real chat or ticket
 * source, so case messages are covered by the unit tests and the stubbed
 * orchestrator-agents.spec.ts.
 */

import { randomUUID } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { ApiResult } from "@repo/api/src/types/common";
import type { RegisterComputeTargetResponse } from "@repo/api/src/types/compute-target";
import {
  OrchestratorConcurrency,
  type WorkflowAgentMap,
} from "@repo/api/src/types/orchestrator";
import type { ProjectRunners } from "@repo/api/src/types/project-runners";
import { RunnerCapabilitiesSource } from "@repo/api/src/types/runner-capabilities";
import {
  WORKFLOW_RUN_FINAL_STATUSES,
  WorkflowRunErrorCode,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { bearer, readApiResult } from "./helpers/api-result";
import { getApiBaseUrl } from "./helpers/api-url";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { deleteComputeTarget } from "./helpers/compute-targets";
import { createProject, deleteProject } from "./helpers/create-project";
import { E2ETag } from "./helpers/tags";
import { createUniqueName } from "./helpers/utils";
import {
  deleteWorkflow,
  type SaveWorkflowRequest,
  waitForWorkflowRunStatus,
} from "./helpers/workflows";
import { expect, test } from "./test";

/** Trigger key of the built-in webhook provider. */
const WebhookIntegrationKey = { RequestTrigger: "webhook.request" } as const;

const HttpStatus = {
  Ok: 200,
  BadRequest: 400,
  NotFound: 404,
} as const;

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to start runs by hand";
const RUN_FAILURE_TIMEOUT_MS = 60_000;
const RULE_CONDITION = 'source.type == "bug"';
const AGENTFLOW_MD =
  "---\ncommands:\n  - { name: /ba-clarify, mode: read }\n---\n# BA\n";

const NOT_IN_ORG_RE = /is not in this organization/;
const PERSONAL_OF_OTHER_RE = /is a personal Agent of project/;
const NOT_PROJECT_AGENT_RE = /is not one of the Agents of project/;
const RULE_AGENT_RE = /Runner rule 1's Agent/;

test.describe("agents of a project", { tag: E2ETag.Smoke }, () => {
  test("a personal Agent registers only for a project of the org and joins only that project", async ({
    apiToken: token,
    request,
  }) => {
    const fixture = new Fixture();
    try {
      const projectA = await fixture.project(request, token, "e2e-scope-a");
      const projectB = await fixture.project(request, token, "e2e-scope-b");
      expect(projectA.slug).toBeTruthy();

      const unknownKey = await postRegister(request, token, {
        machineName: createUniqueName("e2e-personal-unknown"),
        projectKey: `NOPE-${randomUUID().slice(0, 8)}`,
      });
      expect(unknownKey.status()).toBe(HttpStatus.BadRequest);
      expect(await errorOf(unknownKey)).toMatch(NOT_IN_ORG_RE);

      const personal = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-personal-a"),
        projectKey: projectA.slug ?? "",
      });

      // Registered in the org only: waiting on its own project, absent elsewhere.
      const runnersA = await getRunners(request, token, projectA.id);
      expect(runnersA.runners.map((r) => r.id)).not.toContain(personal);
      expect(runnersA.waiting.map((r) => r.id)).toContain(personal);
      const runnersB = await getRunners(request, token, projectB.id);
      expect(runnersB.waiting.map((r) => r.id)).not.toContain(personal);

      const intoB = await putRunners(request, token, projectB.id, [personal]);
      expect(intoB.status()).toBe(HttpStatus.BadRequest);
      expect(await errorOf(intoB)).toMatch(PERSONAL_OF_OTHER_RE);

      const intoA = await putRunners(request, token, projectA.id, [personal]);
      expect(intoA.status()).toBe(HttpStatus.Ok);
      const added = await getRunners(request, token, projectA.id);
      expect(added.runners.map((r) => [r.id, r.kind])).toEqual([
        [personal, "personal"],
      ]);
      expect(added.waiting.map((r) => r.id)).not.toContain(personal);
    } finally {
      await fixture.cleanUp(request, token);
    }
  });

  test("a workflow saves only with Agents of its project; a project without Agents takes any", async ({
    apiToken: token,
    request,
  }) => {
    const fixture = new Fixture();
    try {
      const project = await fixture.project(request, token, "e2e-scope-wf");
      const open = await fixture.project(request, token, "e2e-scope-open");
      const inside = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-agent-in"),
      });
      const outside = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-agent-out"),
      });
      await expectOk(await putRunners(request, token, project.id, [inside]));

      const defaultOutside = await postWorkflow(
        request,
        token,
        planWorkflow(project.id, outside)
      );
      expect(defaultOutside.status()).toBe(HttpStatus.BadRequest);
      expect(await errorOf(defaultOutside)).toMatch(NOT_PROJECT_AGENT_RE);

      const ruleOutside = await postWorkflow(request, token, {
        ...planWorkflow(project.id, inside),
        agent: {
          ...planWorkflow(project.id, inside).agent,
          runners: [{ computeTargetId: outside, condition: RULE_CONDITION }],
        },
      });
      expect(ruleOutside.status()).toBe(HttpStatus.BadRequest);
      expect(await errorOf(ruleOutside)).toMatch(RULE_AGENT_RE);

      const saved = await postWorkflow(
        request,
        token,
        planWorkflow(project.id, inside)
      );
      fixture.workflowIds.push(await idOf(saved));

      const anyAgent = await postWorkflow(
        request,
        token,
        planWorkflow(open.id, outside)
      );
      fixture.workflowIds.push(await idOf(anyAgent));
    } finally {
      await fixture.cleanUp(request, token);
    }
  });

  test("a run whose Agent left the project fails with agent_not_in_project", async ({
    apiToken: token,
    request,
  }) => {
    const { orgRole } = requireOrgClaims(token);
    expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
    const fixture = new Fixture();
    try {
      const project = await fixture.project(request, token, "e2e-scope-run");
      const first = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-agent-first"),
      });
      const second = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-agent-second"),
      });
      await expectOk(await putRunners(request, token, project.id, [first]));
      const workflow = await readApiResult<{
        id: string;
        triggers: { id: string }[];
      }>(
        await postWorkflow(request, token, planWorkflow(project.id, first)),
        "Create workflow"
      );
      fixture.workflowIds.push(workflow.id);
      // The Agent leaves the project after the workflow was saved.
      await expectOk(await putRunners(request, token, project.id, [second]));

      await startManualRun(request, token, workflow);

      const failed = await waitForWorkflowRunStatus(request, {
        workflowId: workflow.id,
        status: WorkflowRunStatus.Failed,
        finalStatuses: WORKFLOW_RUN_FINAL_STATUSES,
        token,
        timeoutMs: RUN_FAILURE_TIMEOUT_MS,
      });
      expect(failed.error?.code).toBe(WorkflowRunErrorCode.AgentNotInProject);
    } finally {
      await fixture.cleanUp(request, token);
    }
  });

  test("the agent map lists the orchestrator and only the project's Agents", async ({
    apiToken: token,
    request,
  }) => {
    const fixture = new Fixture();
    try {
      const project = await fixture.project(request, token, "e2e-scope-map");
      const orchestrator = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-orchestrator"),
      });
      const ba = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-ba"),
      });
      const outside = await fixture.agent(request, token, {
        machineName: createUniqueName("e2e-outside"),
      });
      // Both declare an AGENTFLOW.md for the project; only one is its Agent.
      await uploadAgentflowMd(request, token, ba, project.id);
      await uploadAgentflowMd(request, token, outside, project.id);
      await expectOk(
        await putRunners(request, token, project.id, [orchestrator, ba])
      );
      const workflow = await readApiResult<{ id: string }>(
        await postWorkflow(
          request,
          token,
          orchestratedWorkflow(project.id, orchestrator)
        ),
        "Create orchestrated workflow"
      );
      fixture.workflowIds.push(workflow.id);

      const map = await readApiResult<WorkflowAgentMap>(
        await request.get(
          `${getApiBaseUrl()}/workflows/${workflow.id}/agents`,
          {
            headers: bearer(token),
          }
        ),
        "Read the agent map"
      );
      expect(map.orchestrator?.computeTargetId).toBe(orchestrator);
      const ids = map.agents.map((agent) => agent.computeTargetId);
      expect(ids).toContain(ba);
      expect(ids).not.toContain(outside);
      expect(map.agents.find((a) => a.computeTargetId === ba)?.declared).toBe(
        true
      );

      const unknown = await request.get(
        `${getApiBaseUrl()}/workflows/${randomUUID()}/agents`,
        { headers: bearer(token) }
      );
      expect(unknown.status()).toBe(HttpStatus.NotFound);
    } finally {
      await fixture.cleanUp(request, token);
    }
  });
});

/** Ids created by one test, removed workflows first. */
class Fixture {
  projectIds: string[] = [];
  agentIds: string[] = [];
  workflowIds: string[] = [];

  async project(request: APIRequestContext, token: string, prefix: string) {
    const project = await createProject(request, {
      name: createUniqueName(prefix),
      token,
    });
    this.projectIds.push(project.id);
    return project;
  }

  /** Registers an automatic Agent, or a personal one when projectKey is set. */
  async agent(
    request: APIRequestContext,
    token: string,
    input: { machineName: string; projectKey?: string }
  ): Promise<string> {
    const target = await readApiResult<RegisterComputeTargetResponse>(
      await postRegister(request, token, input),
      `Register ${input.machineName}`
    );
    this.agentIds.push(target.id);
    return target.id;
  }

  async cleanUp(request: APIRequestContext, token: string): Promise<void> {
    for (const id of this.workflowIds) {
      await deleteWorkflow(request, id, token);
    }
    for (const id of this.projectIds) {
      await deleteProject(request, id, token);
    }
    for (const id of this.agentIds) {
      await deleteComputeTarget(request, id, token);
    }
  }
}

function postRegister(
  request: APIRequestContext,
  token: string,
  input: { machineName: string; projectKey?: string }
): Promise<APIResponse> {
  return request.post(`${getApiBaseUrl()}/compute-targets/register`, {
    data: {
      machineName: input.machineName,
      platform: "e2e",
      capabilities: input.projectKey
        ? { personalRunner: { projectKey: input.projectKey } }
        : { source: "agents-project-scope-e2e" },
      supportedOperations: ["loop.run"],
    },
    headers: bearer(token),
  });
}

async function getRunners(
  request: APIRequestContext,
  token: string,
  projectId: string
): Promise<ProjectRunners> {
  return readApiResult<ProjectRunners>(
    await request.get(`${getApiBaseUrl()}/projects/${projectId}/runners`, {
      headers: bearer(token),
    }),
    "Read the project's Agents"
  );
}

function putRunners(
  request: APIRequestContext,
  token: string,
  projectId: string,
  runnerIds: string[]
): Promise<APIResponse> {
  return request.put(`${getApiBaseUrl()}/projects/${projectId}/runners`, {
    data: { runnerIds },
    headers: bearer(token),
  });
}

function postWorkflow(
  request: APIRequestContext,
  token: string,
  input: SaveWorkflowRequest
): Promise<APIResponse> {
  return request.post(`${getApiBaseUrl()}/workflows`, {
    data: input,
    headers: bearer(token),
  });
}

async function uploadAgentflowMd(
  request: APIRequestContext,
  token: string,
  computeTargetId: string,
  projectId: string
): Promise<void> {
  await readApiResult(
    await request.put(
      `${getApiBaseUrl()}/compute-targets/${computeTargetId}/capabilities`,
      {
        data: {
          project: projectId,
          source: RunnerCapabilitiesSource.Toolkit,
          content: AGENTFLOW_MD,
          warnings: [],
        },
        headers: bearer(token),
      }
    ),
    "Upload AGENTFLOW.md"
  );
}

async function startManualRun(
  request: APIRequestContext,
  token: string,
  workflow: { id: string; triggers: { id: string }[] }
): Promise<void> {
  const triggerId = workflow.triggers[0]?.id ?? "";
  const response = await request.post(
    `${getApiBaseUrl()}/workflows/${workflow.id}/runs`,
    {
      data: {
        triggerId,
        input: JSON.stringify({
          id: createUniqueName("e2e-item"),
          title: "Agents scope item",
        }),
      },
      headers: bearer(token),
    }
  );
  expect(response.status(), await response.text()).toBe(HttpStatus.Ok);
}

function planWorkflow(
  projectId: string,
  computeTargetId: string
): SaveWorkflowRequest {
  return {
    name: createUniqueName("e2e-scope-workflow"),
    projectId,
    agent: {
      mode: WorkflowAgentMode.PlanAndExecute,
      computeTargetId,
      stopOnOpenQuestions: true,
      repository: null,
      instructions: "",
    },
    triggers: [
      {
        connectionKey: null,
        type: WebhookIntegrationKey.RequestTrigger,
        config: {},
      },
    ],
    actions: [],
  };
}

function orchestratedWorkflow(
  projectId: string,
  computeTargetId: string
): SaveWorkflowRequest {
  return {
    name: createUniqueName("e2e-scope-orchestrated"),
    projectId,
    agent: {
      mode: WorkflowAgentMode.Orchestrated,
      computeTargetId,
      instructions: "Ask BA first.",
      orchestrator: {
        concurrency: OrchestratorConcurrency.Queue,
        debounceSeconds: 5,
        turnTimeoutMinutes: 3,
      },
    },
    triggers: [
      {
        connectionKey: null,
        type: WebhookIntegrationKey.RequestTrigger,
        config: {},
      },
    ],
    actions: [],
  };
}

async function errorOf(response: APIResponse): Promise<string> {
  const body = (await response
    .json()
    .catch(() => null)) as ApiResult<unknown> | null;
  return body && !body.success ? body.error : "";
}

async function idOf(response: APIResponse): Promise<string> {
  return (await readApiResult<{ id: string }>(response, "Save workflow")).id;
}

async function expectOk(response: APIResponse): Promise<void> {
  expect(response.status(), await response.text()).toBe(HttpStatus.Ok);
}
