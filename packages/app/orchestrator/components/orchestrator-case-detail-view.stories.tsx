import {
  type OrchestratorCaseDetail,
  type OrchestratorCaseLoops,
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorDocumentKind,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
  OrchestratorTurnEnd,
  OrchestratorTurnStatus,
  OrchestratorWaitKind,
} from "@repo/api/src/types/orchestrator";
import type { Meta, StoryObj } from "@storybook/react";
import type { FixtureRoute } from "../../shared/storybook/fixture-fetch";
import { OrchestratorCaseDetailView } from "./orchestrator-case-detail-view";

const CASE_ID = "01CASE0000000000000000000";
const CONVERSATION_ID = "01CONV0000000000000000000";
const TURN_ID = "01TURN0000000000000000000";
const TURN_B_ID = "01TURN0000000000000000001";
const TASK_1_ID = "01TASK0000000000000000001";
const TASK_2_ID = "01TASK0000000000000000002";
const TASK_3_ID = "01TASK0000000000000000003";
const ANN_MESSAGE_ID = "01MSG00000000000000000001";

const fixture: OrchestratorCaseDetail = {
  id: CASE_ID,
  projectId: "01PROJECT000000000000000",
  workflowId: "01WORKFLOW0000000000000",
  title: "PROJ-7 login fails on Safari",
  sourceKey: "jira:PROJ-7",
  status: OrchestratorCaseStatus.Open,
  conversationCount: 1,
  pendingDecisionCount: 1,
  activeTaskCount: 1,
  turnRunning: true,
  taskCount: 3,
  turnCount: 2,
  costUsd: 1.37,
  inputTokens: 12_000,
  outputTokens: 3000,
  activeMs: 5_400_000,
  closedAt: null,
  createdAt: "2026-10-26T08:00:00.000Z",
  updatedAt: "2026-10-26T08:10:00.000Z",
  notes: "Reproduced on Safari 17. Waiting for the plan approval.",
  project: { id: "01PROJECT000000000000000", name: "Web" },
  workflow: { id: "01WORKFLOW0000000000000", name: "Orchestrated" },
  conversations: [
    {
      id: CONVERSATION_ID,
      channelKey: "jira:PROJ-7",
      status: OrchestratorConversationStatus.Turn,
      createdAt: "2026-10-26T08:00:00.000Z",
      messages: [
        {
          id: ANN_MESSAGE_ID,
          conversationId: CONVERSATION_ID,
          origin: OrchestratorMessageOrigin.External,
          kind: OrchestratorMessageKind.Message,
          actor: "Ann",
          text: "@bot please look at the login failure.",
          turnId: TURN_ID,
          createdAt: "2026-10-26T08:00:00.000Z",
        },
        {
          id: "01MSG00000000000000000002",
          conversationId: CONVERSATION_ID,
          origin: OrchestratorMessageOrigin.External,
          kind: OrchestratorMessageKind.StatusChanged,
          actor: "Ann",
          text: "Status changed: To Do → Ready for Development (by Ann)",
          turnId: TURN_ID,
          createdAt: "2026-10-26T08:00:30.000Z",
        },
        {
          id: "01MSG00000000000000000003",
          conversationId: CONVERSATION_ID,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.Reply,
          actor: "Orchestrator",
          text: "On it. I asked the developer agent to plan the fix.",
          turnId: TURN_ID,
          createdAt: "2026-10-26T08:02:10.000Z",
          via: OrchestratorMessageVia.AgentFlow,
        },
        {
          id: "01MSG00000000000000000004",
          conversationId: CONVERSATION_ID,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.ToolRefused,
          actor: "Orchestrator",
          text: "page_publish refused: the plan is not approved yet.",
          turnId: TURN_ID,
          createdAt: "2026-10-26T08:02:20.000Z",
        },
        {
          id: "01MSG00000000000000000005",
          conversationId: CONVERSATION_ID,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.TaskResults,
          actor: "Orchestrator",
          text: "Task 1 finished.",
          turnId: TURN_B_ID,
          createdAt: "2026-10-26T08:05:00.005Z",
        },
      ],
      turns: [
        {
          id: TURN_ID,
          conversationId: CONVERSATION_ID,
          status: OrchestratorTurnStatus.Succeeded,
          ended: OrchestratorTurnEnd.WaitTasks,
          summary:
            "Asked the developer agent to plan the fix and waited for it.",
          error: null,
          usage: { costUsd: 0.42, inputTokens: 8000, outputTokens: 1200 },
          runnerName: "runner-dev",
          startedAt: "2026-10-26T08:01:00.000Z",
          finishedAt: "2026-10-26T08:02:30.000Z",
        },
        {
          id: TURN_B_ID,
          conversationId: CONVERSATION_ID,
          status: OrchestratorTurnStatus.Running,
          ended: null,
          summary: null,
          error: null,
          usage: null,
          runnerName: "runner-dev",
          startedAt: "2026-10-26T08:05:00.000Z",
          finishedAt: null,
        },
      ],
    },
  ],
  tasks: [
    {
      id: TASK_1_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      command: "/plan",
      args: "PROJ-7",
      prompt: "Plan the fix",
      mode: "plan",
      runnerName: "ChucTran-DU1-Develop-PRO-1",
      computeTargetId: null,
      status: OrchestratorTaskStatus.Succeeded,
      fork: false,
      resumeTaskId: null,
      loopId: "01LOOP0000000000000000001",
      reply:
        "The plan is ready. Safari blocks the third-party cookie the login relies on.",
      files: [
        { name: "plan.md", size: 12_595, stored: true, skipped: null },
        { name: "big.bin", size: 900, stored: false, skipped: "too large" },
      ],
      filesOmitted: 0,
      openQuestionCount: 1,
      inputs: [
        {
          name: "PROJ-7 Login spec",
          size: 4200,
          fromTaskId: null,
          page: {
            title: "PROJ-7 Login spec",
            url: "https://example.atlassian.net/wiki/spaces/ENG/pages/1000",
            version: 3,
          },
        },
      ],
      replyTo: "c-ann",
      replyToMessageId: ANN_MESSAGE_ID,
      questions: [
        {
          id: "q1",
          question: "Should the fix also cover Safari 16?",
          options: ["Yes", "No"],
        },
      ],
      error: null,
      waiting: null,
      createdAt: "2026-10-26T08:02:00.000Z",
      finishedAt: "2026-10-26T08:05:00.000Z",
    },
    {
      id: TASK_2_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_B_ID,
      command: "/plan",
      args: "PROJ-7",
      prompt: "Update the plan. Answers: Safari 16 is out of scope.",
      mode: "plan",
      runnerName: "ChucTran-DU1-Develop-PRO-1",
      computeTargetId: null,
      status: OrchestratorTaskStatus.Running,
      fork: false,
      resumeTaskId: TASK_1_ID,
      loopId: "01LOOP0000000000000000002",
      reply: null,
      files: [],
      filesOmitted: 0,
      openQuestionCount: 0,
      inputs: [
        { name: "plan.md", size: 12_595, fromTaskId: TASK_1_ID, page: null },
      ],
      replyTo: null,
      replyToMessageId: null,
      questions: [],
      error: null,
      waiting: null,
      createdAt: "2026-10-26T08:05:10.000Z",
      finishedAt: null,
    },
    {
      id: TASK_3_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      command: "/review",
      args: "PROJ-7",
      prompt: "Review the login change",
      mode: "plan",
      runnerName: "ChucTran-DU1-Develop-PRO-1",
      computeTargetId: null,
      status: OrchestratorTaskStatus.Cancelled,
      fork: false,
      resumeTaskId: null,
      loopId: null,
      reply: null,
      files: [],
      filesOmitted: 0,
      openQuestionCount: 0,
      inputs: [],
      replyTo: null,
      replyToMessageId: null,
      questions: [],
      error: "Cancelled by the orchestrator: the plan changed.",
      waiting: null,
      createdAt: "2026-10-26T08:02:05.000Z",
      finishedAt: "2026-10-26T08:03:00.000Z",
    },
  ],
  waits: [
    {
      id: "01WAIT0000000000000000001",
      conversationId: CONVERSATION_ID,
      kind: OrchestratorWaitKind.All,
      taskIds: ["01TASK0000000000000000001"],
      deadline: null,
      wakeOnFailure: true,
      firedAt: null,
      createdAt: "2026-10-26T08:02:00.000Z",
    },
  ],
  decisions: [
    {
      id: "01DEC00000000000000000001",
      conversationId: CONVERSATION_ID,
      question: "Approve the plan for PROJ-7?",
      status: OrchestratorDecisionStatus.Pending,
      via: null,
      decidedBy: null,
      comment: null,
      decidedAt: null,
      draft: null,
      draftResult: null,
      createdAt: "2026-10-26T08:06:00.000Z",
    },
  ],
  documents: [
    {
      pageId: "1001",
      title: "PROJ-7 Implementation plan",
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/1001",
      kind: OrchestratorDocumentKind.Plan,
      version: 2,
      attachments: ["login.png"],
      publishedAt: "2026-10-26T08:05:00.000Z",
    },
  ],
};

const loopsFixture: OrchestratorCaseLoops = {
  loops: [
    {
      loopId: "01LOOP0000000000000000001",
      command: "ba-prd",
      status: "COMPLETED",
      adopted: false,
      stepId: null,
      prUrl: "https://example.test/acme/web/pull/7",
      startedAt: new Date("2026-10-26T08:02:00.000Z"),
      completedAt: new Date("2026-10-26T08:05:00.000Z"),
    },
    {
      loopId: "01LOOP0000000000000000002",
      command: "/plan",
      status: "RUNNING",
      adopted: false,
      stepId: null,
      prUrl: null,
      startedAt: new Date("2026-10-26T08:06:00.000Z"),
      completedAt: null,
    },
  ],
  sessions: [
    {
      id: "01SESSION00000000000000001",
      slug: "plan-proj-7",
      name: "Plan PROJ-7",
      loopId: "01LOOP0000000000000000002",
      command: "/plan",
      stepId: null,
      status: "active",
      harness: "claude",
      model: null,
      startedAt: new Date("2026-10-26T08:06:00.000Z"),
      lastActivityAt: new Date("2026-10-26T08:09:00.000Z"),
      endedAt: null,
    },
  ],
  pullRequests: [
    {
      url: "https://example.test/acme/web/pull/7",
      number: 7,
      repository: "acme/web",
      branch: "proj-7-login",
    },
  ],
};

const caseRoutes: FixtureRoute[] = [
  {
    method: "GET",
    path: `/orchestrator/cases/${CASE_ID}/loops`,
    respond: () => loopsFixture,
  },
  { method: "GET", path: "/orchestrator/cases/*", respond: () => fixture },
  { method: "POST", path: "/orchestrator/decisions/*", respond: () => ({}) },
];

const meta: Meta<typeof OrchestratorCaseDetailView> = {
  title: "App Core/Orchestrator/Case Detail View",
  component: OrchestratorCaseDetailView,
  parameters: { appCore: { apiRoutes: caseRoutes } },
  args: { caseId: CASE_ID, isAdmin: true },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Admin: Story = {};

export const Member: Story = {
  args: { isAdmin: false },
};
