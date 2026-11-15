import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AfAttribute } from "../af-attributes";
import { buildAfBaggage, parseAfBaggage, pickAfIds } from "../af-baggage";
import { getActiveAfIds, setActiveSpanAttributes, withSpan } from "../span";
import { installInMemorySpans } from "../testing/in-memory-spans";
import { toLogCorrelationFields } from "../trace-context";

describe("active af ids", () => {
  let spans: ReturnType<typeof installInMemorySpans>;

  beforeEach(() => {
    spans = installInMemorySpans();
  });

  afterEach(() => {
    spans.uninstall();
  });

  it("merges ids of nested spans", async () => {
    await withSpan("org", { [AfAttribute.OrgId]: "org_1" }, () =>
      withSpan("task", { [AfAttribute.TaskId]: "task_1" }, () =>
        withSpan("loop", { [AfAttribute.LoopId]: "loop_1" }, () => {
          expect(getActiveAfIds()).toEqual({
            [AfAttribute.OrgId]: "org_1",
            [AfAttribute.TaskId]: "task_1",
            [AfAttribute.LoopId]: "loop_1",
          });
        })
      )
    );
  });

  it("does not leak ids outside the span", async () => {
    await withSpan("org", { [AfAttribute.OrgId]: "org_1" }, () => undefined);
    expect(getActiveAfIds()).toEqual({});
  });

  it("setActiveSpanAttributes ids are visible to nested spans", async () => {
    await withSpan("outer", {}, () => {
      setActiveSpanAttributes({ [AfAttribute.CaseId]: "case_1" });
      return withSpan("inner", {}, () => {
        expect(getActiveAfIds()[AfAttribute.CaseId]).toBe("case_1");
      });
    });
  });

  it("log correlation fields carry the active af ids", async () => {
    await withSpan("loop", { [AfAttribute.LoopId]: "loop_1" }, (span) => {
      const { traceId, spanId } = span.spanContext();
      const fields = toLogCorrelationFields({
        traceId,
        spanId,
        afIds: getActiveAfIds(),
      });
      expect(fields[AfAttribute.LoopId]).toBe("loop_1");
      expect(fields.trace_id).toBe(traceId);
    });
  });
});

describe("af baggage", () => {
  it("round-trips ids in allow-list order", () => {
    const ids = {
      [AfAttribute.LoopId]: "loop_1",
      [AfAttribute.OrgId]: "org-1",
      [AfAttribute.CaseId]: "case_1",
    };
    const baggage = buildAfBaggage(ids);
    expect(baggage).toBe("af.org_id=org-1,af.case_id=case_1,af.loop_id=loop_1");
    expect(parseAfBaggage(baggage)).toEqual(ids);
  });

  it("returns undefined for no ids", () => {
    expect(buildAfBaggage({})).toBeUndefined();
  });

  it("pickAfIds drops unknown keys and unsafe values", () => {
    expect(
      pickAfIds({
        [AfAttribute.OrgId]: "org_1",
        [AfAttribute.UserId]: "user_1",
        [AfAttribute.CaseId]: "a,b",
        [AfAttribute.TaskId]: 5,
      })
    ).toEqual({ [AfAttribute.OrgId]: "org_1" });
  });

  it("parse rejects bad members", () => {
    // The comma splits members, so "a,b" never survives as one value.
    expect(parseAfBaggage("af.case_id=a,b")).toEqual({
      [AfAttribute.CaseId]: "a",
    });
    expect(parseAfBaggage("af.case_id=a%2Cb")).toEqual({});
    expect(parseAfBaggage("x=1")).toEqual({});
    expect(parseAfBaggage("af.case_id=a=b")).toEqual({});
    expect(parseAfBaggage(`af.case_id=${"a".repeat(65)}`)).toEqual({});
    expect(
      parseAfBaggage(`af.case_id=a,af.task_id=${"b".repeat(600)}`)
    ).toEqual({});
    expect(parseAfBaggage(42)).toEqual({});
  });

  it("parse ignores properties after a semicolon", () => {
    expect(parseAfBaggage("af.case_id=case_1;prop=1")).toEqual({
      [AfAttribute.CaseId]: "case_1",
    });
  });
});
