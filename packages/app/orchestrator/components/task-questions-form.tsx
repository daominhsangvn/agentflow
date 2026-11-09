"use client";

import type { OrchestratorCaseTask } from "@repo/api/src/types/orchestrator";
import { Button } from "@repo/design-system/components/ui/button";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useState } from "react";
import { usePostOrchestratorCaseMessage } from "../hooks/use-orchestrator-cases";

export function TaskQuestionsForm({
  task,
  caseId,
  title,
}: Readonly<{ task: OrchestratorCaseTask; caseId: string; title?: string }>) {
  const post = usePostOrchestratorCaseMessage(caseId);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const filled = task.questions.filter(
    (question) => (answers[question.id] ?? "").trim().length > 0
  );

  const submit = async () => {
    try {
      await post.mutateAsync({
        conversationId: task.conversationId,
        answers: filled.map((question) => ({
          taskId: task.id,
          questionId: question.id,
          answer: (answers[question.id] ?? "").trim(),
        })),
      });
      setAnswers({});
      setSent(true);
    } catch {
      // The global mutation handler toasts the error; keep the typed answers.
    }
  };

  if (sent) {
    return (
      <p
        className="text-muted-foreground text-xs"
        data-testid="orchestrator-task-answers-sent"
      >
        Answers sent. The orchestrator picks them up on its next turn.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="orchestrator-task-questions">
      {title ? <p className="font-medium text-sm">{title}</p> : null}
      {task.questions.map((question) => (
        <div className="space-y-1" key={question.id}>
          <Label htmlFor={`${task.id}-${question.id}`}>
            {question.question}
          </Label>
          {question.options && question.options.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {question.options.map((option) => (
                <Button
                  key={option}
                  onClick={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option,
                    }))
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : null}
          <Textarea
            id={`${task.id}-${question.id}`}
            onChange={(event) =>
              setAnswers((current) => ({
                ...current,
                [question.id]: event.target.value,
              }))
            }
            value={answers[question.id] ?? ""}
          />
        </div>
      ))}
      <Button
        disabled={filled.length === 0 || post.isPending}
        onClick={submit}
        size="sm"
        type="button"
      >
        Send answers
      </Button>
    </div>
  );
}
