// Jira "Blocks" issue links as blocking relations: an `inwardIssue` is "is blocked by",
// an `outwardIssue` is "blocks". Other link types are ignored.
import type { SourceItemRelation } from "../../types";
import { jiraIssueBrowseUrl } from "./client";
import type { JiraIssueLink } from "./schemas";

type LinkedIssue = NonNullable<JiraIssueLink["inwardIssue"]>;

export function jiraIssueRelations(
  siteUrl: string,
  links: JiraIssueLink[] | null | undefined
): { blockedBy: SourceItemRelation[]; blocks: SourceItemRelation[] } {
  const blockLinks = (links ?? []).filter(
    (link) => link.type?.name?.trim().toLowerCase() === BLOCKS_LINK_TYPE
  );
  return {
    blockedBy: relationsOf(
      siteUrl,
      blockLinks.map((link) => link.inwardIssue)
    ),
    blocks: relationsOf(
      siteUrl,
      blockLinks.map((link) => link.outwardIssue)
    ),
  };
}

const BLOCKS_LINK_TYPE = "blocks";
const RELATIONS_MAX = 50;

function relationsOf(
  siteUrl: string,
  issues: (LinkedIssue | null | undefined)[]
): SourceItemRelation[] {
  return issues
    .filter((issue): issue is LinkedIssue => Boolean(issue))
    .slice(0, RELATIONS_MAX)
    .map((issue) => ({
      key: issue.key,
      title: issue.fields?.summary ?? null,
      status: issue.fields?.status?.name ?? null,
      url: jiraIssueBrowseUrl(siteUrl, issue.key),
    }));
}
