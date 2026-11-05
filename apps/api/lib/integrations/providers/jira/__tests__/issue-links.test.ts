import { describe, expect, it } from "vitest";
import { jiraIssueRelations } from "../issue-links";
import {
  type JiraIssueLink,
  jiraIssueLinkSchema,
  jiraIssueSchema,
} from "../schemas";
import { toSourceItem } from "../source";
import { CLOUD_SITE_URL } from "./jira.test-helpers";

function link(value: unknown): JiraIssueLink {
  return jiraIssueLinkSchema.parse(value);
}

const LOGIN = {
  key: "LD-1",
  fields: { summary: "Login", status: { name: "Done" } },
};

describe("jiraIssueRelations", () => {
  it("maps an inward Blocks link to blockedBy", () => {
    const result = jiraIssueRelations(CLOUD_SITE_URL, [
      link({ type: { name: "Blocks" }, inwardIssue: LOGIN }),
    ]);
    expect(result.blockedBy).toEqual([
      {
        key: "LD-1",
        title: "Login",
        status: "Done",
        url: `${CLOUD_SITE_URL}/browse/LD-1`,
      },
    ]);
    expect(result.blocks).toEqual([]);
  });

  it("maps an outward Blocks link to blocks", () => {
    const result = jiraIssueRelations(CLOUD_SITE_URL, [
      link({ type: { name: "Blocks" }, outwardIssue: LOGIN }),
    ]);
    expect(result.blocks.map((relation) => relation.key)).toEqual(["LD-1"]);
    expect(result.blockedBy).toEqual([]);
  });

  it("ignores other link types", () => {
    const result = jiraIssueRelations(CLOUD_SITE_URL, [
      link({ type: { name: "Relates" }, inwardIssue: LOGIN }),
      link({ type: { name: "Cloners" }, outwardIssue: LOGIN }),
    ]);
    expect(result).toEqual({ blockedBy: [], blocks: [] });
  });

  it("matches the type name case-insensitively", () => {
    const result = jiraIssueRelations(CLOUD_SITE_URL, [
      link({ type: { name: " bLOCKS " }, inwardIssue: LOGIN }),
    ]);
    expect(result.blockedBy).toHaveLength(1);
  });

  it("leaves title and status null without fields", () => {
    const result = jiraIssueRelations(CLOUD_SITE_URL, [
      link({ type: { name: "Blocks" }, inwardIssue: { key: "LD-2" } }),
    ]);
    expect(result.blockedBy[0]).toMatchObject({
      key: "LD-2",
      title: null,
      status: null,
    });
  });

  it("returns empty lists for null or undefined links", () => {
    expect(jiraIssueRelations(CLOUD_SITE_URL, null)).toEqual({
      blockedBy: [],
      blocks: [],
    });
    expect(jiraIssueRelations(CLOUD_SITE_URL, undefined)).toEqual({
      blockedBy: [],
      blocks: [],
    });
  });

  it("is carried onto the source item", () => {
    const issue = jiraIssueSchema.parse({
      id: "1",
      key: "LD-5",
      fields: {
        summary: "Task",
        issuelinks: [
          { type: { name: "Blocks" }, inwardIssue: LOGIN },
          { type: { name: "Blocks" }, outwardIssue: { key: "LD-9" } },
        ],
      },
    });
    const item = toSourceItem(CLOUD_SITE_URL, issue, []);
    expect(item.blockedBy?.map((relation) => relation.key)).toEqual(["LD-1"]);
    expect(item.blocks?.map((relation) => relation.key)).toEqual(["LD-9"]);
  });
});
