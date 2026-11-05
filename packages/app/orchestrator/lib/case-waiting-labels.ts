import { OrchestratorCaseWaitingFor } from "@repo/api/src/types/orchestrator";

export const CASE_WAITING_FOR_LABELS: Record<
  OrchestratorCaseWaitingFor,
  string
> = {
  [OrchestratorCaseWaitingFor.Nothing]: "—",
  [OrchestratorCaseWaitingFor.Turn]: "Orchestrator working",
  [OrchestratorCaseWaitingFor.Decision]: "Decision",
  [OrchestratorCaseWaitingFor.Tasks]: "Agent tasks",
  [OrchestratorCaseWaitingFor.Human]: "A person's answer",
  [OrchestratorCaseWaitingFor.NextMessage]: "Next message",
};
