import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  recipients: [] as string[],
  task: null as unknown,
  decision: null as unknown,
  reads: 0,
  sendMail: vi.fn(),
  recipientEmails: vi.fn(),
}));

vi.mock("@/lib/mail-transport", () => ({
  isMailConfigured: () => mocks.configured,
  sendMail: mocks.sendMail,
  describeMailFailure: () => ({ message: "refused", retryable: false }),
}));
vi.mock("@/app/projects/project-agent-contacts-service", () => ({
  projectAgentContactsService: { recipientEmails: mocks.recipientEmails },
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@repo/database", () => {
  const db = {
    orchestratorTask: {
      findUnique: () => {
        mocks.reads += 1;
        return Promise.resolve(mocks.task);
      },
    },
    orchestratorDecision: {
      findUnique: () => {
        mocks.reads += 1;
        return Promise.resolve(mocks.decision);
      },
    },
    computeTarget: {
      findFirst: () => Promise.resolve({ machineName: "orchestrator-box" }),
    },
  };
  return { withDb: (fn: (d: typeof db) => unknown) => fn(db) };
});

import {
  buildNeedsPersonMail,
  itemKeyOf,
  mailDecisionRequested,
  mailTaskQuestions,
  NeedsPersonReason,
} from "@/lib/orchestrator/needs-person-mail";

const ORG = "org-1";
const PROJECT = "project-1";
const TARGET = "0199a5f0-0000-7000-8000-0000000000c1";
const ORCHESTRATOR = "0199a5f0-0000-7000-8000-0000000000c9";
const CASE = "case-1";
const WORKFLOW = "workflow-1";
const TASK_ID_RE =
  /^<orchestrator-task-questions-task-1\.[0-9a-f]{12}@agentflow>$/;
const DECISION_ID_RE =
  /^<orchestrator-decision-decision-1\.[0-9a-f]{12}@agentflow>$/;
const SECRET = "Which database should the secret migration use?";

const CASE_ROW = {
  id: CASE,
  title: "Leave balance",
  sourceKey: "jira:LD-7",
  workflowId: WORKFLOW,
  projectId: PROJECT,
  project: { name: "LeaveDesk" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.reads = 0;
  mocks.recipients = ["ada@acme.dev", "ops@acme.dev"];
  mocks.recipientEmails.mockImplementation(() =>
    Promise.resolve(mocks.recipients)
  );
  mocks.sendMail.mockResolvedValue(undefined);
  mocks.task = {
    organizationId: ORG,
    computeTargetId: TARGET,
    organization: { slug: "acme" },
    computeTarget: { machineName: "dev-box" },
    case: CASE_ROW,
  };
  mocks.decision = {
    organizationId: ORG,
    organization: { slug: "acme" },
    case: {
      ...CASE_ROW,
      workflow: { agentConfig: { computeTargetId: ORCHESTRATOR } },
    },
  };
});

describe("itemKeyOf", () => {
  it("takes the text after the provider", () => {
    expect(itemKeyOf("jira:LD-7")).toBe("LD-7");
    expect(itemKeyOf(null)).toBeNull();
  });
});

describe("buildNeedsPersonMail", () => {
  const base = {
    questionCount: 2,
    agentName: "dev-box",
    projectName: "LeaveDesk",
    itemKey: "LD-7",
    caseTitle: "Leave balance",
    caseUrl: "http://localhost:3000/acme/workflows/w?tab=agents&case=c",
  };

  it("names the project, item, Agent and link for questions", () => {
    const mail = buildNeedsPersonMail({
      ...base,
      reason: NeedsPersonReason.Questions,
    });

    expect(mail.subject).toBe(
      "[AgentFlow] dev-box has questions for you: LD-7 Leave balance"
    );
    expect(mail.text).toContain("Agent dev-box has 2 questions waiting");
    expect(mail.text).toContain("Project: LeaveDesk");
    expect(mail.text).toContain("Item: LD-7 Leave balance");
    expect(mail.text).toContain("Agent: dev-box");
    expect(mail.text).toContain(`Open the case to answer: ${base.caseUrl}`);
  });

  it("says a decision is waiting and uses the title without an item key", () => {
    const mail = buildNeedsPersonMail({
      ...base,
      itemKey: null,
      reason: NeedsPersonReason.Decision,
    });

    expect(mail.subject).toBe(
      "[AgentFlow] A decision is waiting: Leave balance"
    );
    expect(mail.text).toContain("A decision is waiting for a person.");
  });
});

describe("mailTaskQuestions", () => {
  it("sends nothing when the Agent has no contacts", async () => {
    mocks.recipients = [];

    await mailTaskQuestions({ taskId: "task-1", questionCount: 1 });

    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("reads nothing and sends nothing when mail is not configured", async () => {
    mocks.configured = false;

    await mailTaskQuestions({ taskId: "task-1", questionCount: 1 });

    expect(mocks.reads).toBe(0);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("sends one mail per recipient with stable distinct Message-IDs and the case link", async () => {
    await mailTaskQuestions({ taskId: "task-1", questionCount: 1 });
    const first = mocks.sendMail.mock.calls.map(([mail]) => mail);
    mocks.sendMail.mockClear();
    await mailTaskQuestions({ taskId: "task-1", questionCount: 1 });
    const second = mocks.sendMail.mock.calls.map(([mail]) => mail);

    expect(first).toHaveLength(2);
    expect(first.map((mail) => mail.to)).toEqual([
      "ada@acme.dev",
      "ops@acme.dev",
    ]);
    const ids = first.map((mail) => mail.messageId);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(TASK_ID_RE);
    expect(second.map((mail) => mail.messageId)).toEqual(ids);
    expect(first[0].text).toContain(
      `/acme/workflows/${WORKFLOW}?tab=agents&agent=${TARGET}&case=${CASE}`
    );
    expect(mocks.recipientEmails).toHaveBeenCalledWith(ORG, PROJECT, TARGET);
  });

  it("still sends the next mail when one fails", async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error("refused"));

    await mailTaskQuestions({ taskId: "task-1", questionCount: 1 });

    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it("does not put question text in the mail", async () => {
    mocks.task = {
      ...(mocks.task as object),
      case: { ...CASE_ROW, title: "Leave balance" },
    };

    await mailTaskQuestions({ taskId: "task-1", questionCount: 1 });

    for (const [mail] of mocks.sendMail.mock.calls) {
      expect(mail.subject).not.toContain(SECRET);
      expect(mail.text).not.toContain(SECRET);
    }
  });
});

describe("mailDecisionRequested", () => {
  it("emails the contacts of the workflow's orchestrator Agent, linking to the case without an agent", async () => {
    await mailDecisionRequested({ decisionId: "decision-1" });

    expect(mocks.recipientEmails).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      ORCHESTRATOR
    );
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    const [mail] = mocks.sendMail.mock.calls[0];
    expect(mail.messageId).toMatch(DECISION_ID_RE);
    expect(mail.text).toContain(`?tab=agents&case=${CASE}`);
    expect(mail.text).not.toContain("agent=");
    expect(mail.subject).toContain("A decision is waiting");
  });

  it("sends nothing without a valid agent configuration", async () => {
    mocks.decision = {
      ...(mocks.decision as object),
      case: { ...CASE_ROW, workflow: { agentConfig: { nope: true } } },
    };

    await mailDecisionRequested({ decisionId: "decision-1" });

    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("sends nothing when mail is not configured", async () => {
    mocks.configured = false;

    await mailDecisionRequested({ decisionId: "decision-1" });

    expect(mocks.reads).toBe(0);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
