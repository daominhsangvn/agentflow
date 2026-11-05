import {
  type IntegrationFieldDescriptor,
  IntegrationFieldKind,
} from "@repo/api/src/types/integration";
import { z } from "zod";
import {
  HttpMethod,
  type IntegrationProjectDefinition,
  type ProviderContext,
} from "../../types";
import { type JiraContext, JiraErrorKind, jiraRequest } from "./client";
import { JiraDeployment } from "./constants";
import {
  type JiraConnectionConfig,
  type JiraSecrets,
  jiraJqlParseResultSchema,
  jiraSearchResultSchema,
} from "./schemas";

/**
 * Project connections of Jira: a project works on some Jira projects of the
 * site (`projectKeys`). Several AgentFlow projects share the bot of one
 * connection and differ by their keys; a key belongs to one AgentFlow
 * project, whose project connections (one per bot connection) may share it.
 * `issueFilter` optionally narrows the issues (JQL), checked with Jira on save.
 */

const PROJECT_KEYS_MAX = 50;
export const JIRA_ISSUE_FILTER_MAX_LENGTH = 2000;
const ORDER_BY_RE = /\border\s+by\b/i;
const QUOTED_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{0,254}$/;

export const jiraProjectSettingsSchema = z.object({
  projectKeys: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(PROJECT_KEY_RE, "Jira project keys look like PROJ or ABC_2")
    )
    .min(1, "Enter at least one Jira project key")
    .max(PROJECT_KEYS_MAX)
    .transform((keys) => [...new Set(keys)]),
  issueFilter: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z
      .string()
      .trim()
      .max(JIRA_ISSUE_FILTER_MAX_LENGTH)
      .refine(
        (jql) => ORDER_BY_RE.exec(jql.replaceAll(QUOTED_RE, '""')) === null,
        "Leave ORDER BY out of the issue filter"
      )
      .refine(
        hasBalancedParentheses,
        "Close every parenthesis of the issue filter"
      )
      .optional()
  ),
});
export type JiraProjectSettings = z.infer<typeof jiraProjectSettingsSchema>;

const JIRA_PROJECT_SETTINGS_FIELDS: IntegrationFieldDescriptor[] = [
  {
    key: "projectKeys",
    label: "Jira projects",
    kind: IntegrationFieldKind.StringList,
    required: true,
    placeholder: "PROJ",
    description:
      "Keys of the Jira projects this project works on. Issues of these projects start this project's workflows; agents can only read and write issues of these projects. A key belongs to one project; its connections (one per bot) may share it.",
  },
  {
    key: "issueFilter",
    label: "Issue filter (JQL)",
    kind: IntegrationFieldKind.Textarea,
    required: false,
    placeholder: "filter = 10042",
    description:
      "Optional JQL that narrows which issues of these projects start workflows, e.g. filter = 10042 (a board's saved filter) or component = Web. Used by Poll delivery with poll scope \"Every change\"; with webhooks put the same JQL in the Jira webhook's JQL filter. Checked with Jira when saved. Agents can still read and write every issue of these projects.",
  },
];

export const jiraProjectDefinition: IntegrationProjectDefinition<
  JiraConnectionConfig,
  JiraProjectSettings,
  JiraSecrets
> = {
  settingsSchema: jiraProjectSettingsSchema,
  settingsFields: JIRA_PROJECT_SETTINGS_FIELDS,
  containers: (settings) => settings.projectKeys,
  normalizeContainer: (container) => container.trim().toUpperCase(),
  origin: (config) => config.siteUrl.toLowerCase(),
  triggerContainersField: "projectKeys",
  validateSettings: validateJiraProjectSettings,
};

/** Asks Jira whether the issue filter is valid JQL; null when it is (or none is set). */
export async function validateJiraProjectSettings(
  context: ProviderContext<JiraConnectionConfig, JiraSecrets>,
  settings: JiraProjectSettings
): Promise<string | null> {
  if (!settings.issueFilter) {
    return null;
  }
  const jql = `(${settings.issueFilter})`;
  if (context.connection.config.deployment === JiraDeployment.Cloud) {
    return await checkCloudFilter(context, jql);
  }
  return await checkDataCenterFilter(context, jql);
}

async function checkCloudFilter(
  context: JiraContext,
  jql: string
): Promise<string | null> {
  const result = await jiraRequest(
    context,
    {
      method: HttpMethod.Post,
      path: "jql/parse",
      query: { validation: "strict" },
      body: { queries: [jql] },
    },
    jiraJqlParseResultSchema
  );
  if (!result.ok) {
    return `${FILTER_CHECK_FAILED} ${result.error.message}`;
  }
  const errors = result.value.queries?.[0]?.errors ?? [];
  return errors.length > 0 ? `${FILTER_REJECTED} ${errors.join(" ")}` : null;
}

async function checkDataCenterFilter(
  context: JiraContext,
  jql: string
): Promise<string | null> {
  const result = await jiraRequest(
    context,
    {
      method: HttpMethod.Get,
      path: "search",
      query: { jql, maxResults: 0, fields: "id", validateQuery: "strict" },
    },
    jiraSearchResultSchema
  );
  if (result.ok) {
    return null;
  }
  const prefix =
    result.error.kind === JiraErrorKind.BadRequest
      ? FILTER_REJECTED
      : FILTER_CHECK_FAILED;
  return `${prefix} ${result.error.message}`;
}

const FILTER_REJECTED = "Jira rejected the issue filter:";
const FILTER_CHECK_FAILED = "Could not check the issue filter with Jira:";

/** Parentheses outside quoted strings close up, so the filter cannot escape its clause. */
function hasBalancedParentheses(jql: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < jql.length; index++) {
    const char = jql.charAt(index);
    if (quote !== null) {
      if (char === "\\") {
        index++;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0 && quote === null;
}
