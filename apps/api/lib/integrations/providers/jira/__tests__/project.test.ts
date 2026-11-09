import { describe, expect, it } from "vitest";
import { HttpMethod } from "../../../types";
import {
  jiraProjectSettingsSchema,
  validateJiraProjectSettings,
} from "../project";
import {
  dataCenterConfig,
  jsonResponse,
  makeJiraContext,
  requestBody,
  requestQuery,
  routedHttp,
} from "./jira.test-helpers";

const CLOUD_PARSE = "/rest/api/3/jql/parse";
const DC_SEARCH = "/jira/rest/api/2/search";
const SETTINGS = { projectKeys: ["AB"], issueFilter: "filter = 10042" };

describe("validateJiraProjectSettings", () => {
  it("posts the parenthesized filter to Cloud and accepts it without errors", async () => {
    const { http, requests } = routedHttp([
      {
        method: HttpMethod.Post,
        path: CLOUD_PARSE,
        respond: jsonResponse(200, {
          queries: [{ query: "(filter = 10042)", errors: [] }],
        }),
      },
    ]);

    const result = await validateJiraProjectSettings(
      makeJiraContext({ http }),
      SETTINGS
    );

    expect(result).toBeNull();
    expect(requestQuery(requests[0]).get("validation")).toBe("strict");
    expect(requestBody(requests[0])).toEqual({
      queries: ["(filter = 10042)"],
    });
  });

  it("returns Jira's JQL errors on Cloud", async () => {
    const { http } = routedHttp([
      {
        method: HttpMethod.Post,
        path: CLOUD_PARSE,
        respond: jsonResponse(200, {
          queries: [{ errors: ["Field 'x' does not exist.", "Bad."] }],
        }),
      },
    ]);

    const result = await validateJiraProjectSettings(
      makeJiraContext({ http }),
      SETTINGS
    );

    expect(result).toBe(
      "Jira rejected the issue filter: Field 'x' does not exist. Bad."
    );
  });

  it("refuses a Data Center filter Jira answers with 400", async () => {
    const { http } = routedHttp([
      {
        method: HttpMethod.Get,
        path: DC_SEARCH,
        respond: jsonResponse(400, { errorMessages: ["Error in JQL"] }),
      },
    ]);

    const result = await validateJiraProjectSettings(
      makeJiraContext({ http, config: dataCenterConfig() }),
      SETTINGS
    );

    expect(result).toContain("Jira rejected the issue filter:");
  });

  it("refuses the save when Jira cannot be reached", async () => {
    const { http } = routedHttp([
      {
        method: HttpMethod.Get,
        path: DC_SEARCH,
        respond: jsonResponse(503, {}),
      },
    ]);

    const result = await validateJiraProjectSettings(
      makeJiraContext({ http, config: dataCenterConfig() }),
      SETTINGS
    );

    expect(result).toContain("Could not check the issue filter with Jira:");
  });

  it("makes no request without an issue filter", async () => {
    const { http, requests } = routedHttp([]);

    const result = await validateJiraProjectSettings(
      makeJiraContext({ http }),
      { projectKeys: ["AB"] }
    );

    expect(result).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("jiraProjectSettingsSchema issueFilter", () => {
  const messages = (issueFilter: string) =>
    jiraProjectSettingsSchema
      .safeParse({ projectKeys: ["AB"], issueFilter })
      .error?.issues.map((issue) => issue.message);

  it("names the unclosed quote", () => {
    expect(messages('component = "Web')).toEqual([
      "Close every quote of the issue filter",
    ]);
  });

  it("names the unclosed parenthesis", () => {
    expect(messages("(component = Web")).toEqual([
      "Close every parenthesis of the issue filter",
    ]);
  });
});
