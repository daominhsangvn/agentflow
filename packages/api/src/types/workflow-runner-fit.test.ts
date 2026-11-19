import { describe, expect, it } from "vitest";
import { AgentKind } from "./agent-fleet.ts";
import {
  ProcessStepFinish,
  ProcessStepRole,
  ProcessStepType,
  type ProjectProcess,
} from "./project-process.ts";
import { WorkflowAgentMode } from "./workflow-agent-mode.ts";
import {
  leadingSlashCommand,
  type RunnerFitInput,
  RunnerFitProblemCode,
  RunnerFitSeverity,
  runnerFitInTriggerProject,
  workflowRunnerFitProblems,
} from "./workflow-runner-fit.ts";

type StepOverrides = Record<string, unknown>;

const personal = {
  label: "PRO-1-BA",
  kind: AgentKind.Personal,
  commands: null,
};
const automatic = { label: "box", kind: AgentKind.Automatic, commands: null };

describe("workflowRunnerFitProblems", () => {
  it("returns nothing for orchestrated workflows", () => {
    expect(runFit({ mode: WorkflowAgentMode.Orchestrated })).toEqual([]);
  });

  it("errors for a personal runner without any process", () => {
    const problems = runFit({});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: RunnerFitProblemCode.PersonalNeedsAgentSteps,
      severity: RunnerFitSeverity.Error,
      stepIndex: null,
    });
  });

  it("accepts a project process with only agent steps", () => {
    expect(runFit({ projectProcess: processOf(agentStep()) })).toEqual([]);
  });

  it("flags loop steps of the own process", () => {
    const problems = runFit({
      ownProcess: processOf(agentStep(), {
        type: ProcessStepType.AgentFlowPlan,
        id: "p",
        name: "P",
      }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ stepIndex: 1, inOwnProcess: true });
  });

  it("flags finish push and role implement", () => {
    const problems = runFit({
      ownProcess: processOf(
        agentStep({ finish: ProcessStepFinish.Push }),
        agentStep({ id: "a2", role: ProcessStepRole.Implement })
      ),
    });
    expect(problems.map((p) => p.code)).toEqual([
      RunnerFitProblemCode.PersonalPush,
      RunnerFitProblemCode.PersonalPush,
    ]);
  });

  it("accepts an automatic runner without a process", () => {
    expect(runFit({ runners: [automatic] })).toEqual([]);
  });

  it("warns about an undeclared command", () => {
    const problems = runFit({
      ownProcess: processOf(agentStep({ instruction: "/foo" })),
      runners: [{ ...personal, commands: ["/ask"] }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      code: RunnerFitProblemCode.UndeclaredCommand,
      severity: RunnerFitSeverity.Warning,
      stepIndex: 0,
    });
  });

  it("accepts a declared command and skips unknown commands", () => {
    const own = processOf(agentStep());
    expect(
      runFit({
        ownProcess: own,
        runners: [{ ...personal, commands: ["/ask"] }],
      })
    ).toEqual([]);
    expect(runFit({ ownProcess: own, runners: [personal] })).toEqual([]);
  });
});

describe("leadingSlashCommand", () => {
  it("reads the leading command", () => {
    expect(leadingSlashCommand("  /ask x")).toBe("/ask");
    expect(leadingSlashCommand("{{issue.title}}")).toBeNull();
  });
});

function processOf(...steps: StepOverrides[]): ProjectProcess {
  return { steps } as unknown as ProjectProcess;
}

function agentStep(overrides: StepOverrides = {}): StepOverrides {
  return {
    type: ProcessStepType.Agent,
    id: "a1",
    name: "A",
    instruction: "/ask what",
    finish: ProcessStepFinish.None,
    ...overrides,
  };
}

function runFit(overrides: Partial<RunnerFitInput>) {
  return workflowRunnerFitProblems({
    mode: WorkflowAgentMode.Plan,
    ownProcess: null,
    projectProcess: null,
    runners: [personal],
    ...overrides,
  });
}

describe("runnerFitInTriggerProject", () => {
  it("names the trigger project in front of the message", () => {
    expect(runnerFitInTriggerProject("Beta", "no push.")).toBe(
      "Runs of trigger project Beta: no push."
    );
  });
});
