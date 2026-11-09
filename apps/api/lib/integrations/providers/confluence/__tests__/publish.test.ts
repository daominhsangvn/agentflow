import { describe, expect, it } from "vitest";
import { createProviderHttp } from "@/lib/integrations/http";
import {
  type PublishPageInput,
  publishMarkdownPage,
  readPageMarkdown,
  toConfluenceContext,
} from "@/lib/integrations/providers/confluence/publish";
import { HttpMethod } from "@/lib/integrations/types";
import {
  BOT_ID,
  createContext,
  createFakeConfluence,
  ENG_SPACE_ID,
  OPS_SPACE_ID,
  OTHER_PAGE_ID,
  PLAN_PAGE_ID,
  page,
  pageRoute,
  REVIEWER_ID,
  SITE,
  spacesRoute,
} from "./confluence.test-fixtures";

/**
 * Publishing a Markdown file as a Confluence page: where it goes, the guard
 * for people's edits, attachments with images, and reading a page back.
 */

const PARENT_PAGE_ID = "1605633";
const NEW_PAGE_ID = "3342337";
const PAGES_RE = /pages/;
const PAGES_PATH = "/wiki/api/v2/pages";
const SETTINGS = { spaceKeys: ["ENG"], parentPageId: PARENT_PAGE_ID };
const PNG = {
  name: "login.png",
  contentType: "image/png",
  bytes: new Uint8Array([137, 80, 78, 71]),
};

const parentRoute = pageRoute(PARENT_PAGE_ID, { title: "Plans" });
const emptyListRoute = {
  method: HttpMethod.Get,
  path: PAGES_PATH,
  json: { results: [], _links: {} },
};

function input(overrides: Partial<PublishPageInput> = {}): PublishPageInput {
  return {
    title: "LD-6 · PRD",
    markdown: "## Goal\n\nExport orders.",
    page: null,
    parent: null,
    space: null,
    files: [],
    overwrite: false,
    recordedVersions: new Map(),
    ...overrides,
  };
}

function bodyOf(
  fake: ReturnType<typeof createFakeConfluence>,
  method: string,
  path: string
) {
  const request = fake.requests.find(
    (entry) => entry.method === method && entry.url.pathname === path
  );
  return JSON.parse(request?.body ?? "{}");
}

describe("publishMarkdownPage: where the page goes", () => {
  it("creates a page under the project's parent page", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      parentRoute,
      emptyListRoute,
      {
        method: HttpMethod.Post,
        path: PAGES_PATH,
        json: page(NEW_PAGE_ID, { title: "LD-6 · PRD" }),
      },
    ]);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input()
    );

    expect(result).toEqual({
      ok: true,
      value: {
        pageId: NEW_PAGE_ID,
        title: "LD-6 · PRD",
        url: `${SITE}/wiki/spaces/ENG/pages/${NEW_PAGE_ID}/PROJ-7+Implementation+plan`,
        version: 1,
        space: "ENG",
        parentId: PARENT_PAGE_ID,
        created: true,
        attachments: [],
      },
    });
    const created = bodyOf(fake, "POST", PAGES_PATH);
    expect(created).toMatchObject({
      spaceId: ENG_SPACE_ID,
      parentId: PARENT_PAGE_ID,
      title: "LD-6 · PRD",
    });
    expect(created.body.representation).toBe("atlas_doc_format");
  });

  it("creates at the top of the only space for parent root", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      emptyListRoute,
      { method: HttpMethod.Post, path: PAGES_PATH, json: page(NEW_PAGE_ID) },
    ]);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input({ parent: "root" })
    );

    expect(result.ok).toBe(true);
    expect(bodyOf(fake, "POST", PAGES_PATH).parentId).toBeUndefined();
  });

  it("updates the page given, with the next version", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      pageRoute(PLAN_PAGE_ID, {
        version: { number: 3, authorId: BOT_ID },
      }),
      {
        method: HttpMethod.Put,
        path: `${PAGES_PATH}/${PLAN_PAGE_ID}`,
        json: page(PLAN_PAGE_ID),
      },
    ]);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input({ page: PLAN_PAGE_ID })
    );

    expect(result.ok && result.value).toMatchObject({
      pageId: PLAN_PAGE_ID,
      version: 4,
      created: false,
    });
    expect(
      bodyOf(fake, "PUT", `${PAGES_PATH}/${PLAN_PAGE_ID}`).version.number
    ).toBe(4);
  });

  it("updates the page found by title under the same parent", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      parentRoute,
      {
        method: HttpMethod.Get,
        path: PAGES_PATH,
        json: {
          results: [
            page("111", {
              title: "LD-6 · PRD",
              parentId: PARENT_PAGE_ID,
              version: { number: 2, authorId: BOT_ID },
            }),
          ],
        },
      },
      { method: HttpMethod.Put, path: `${PAGES_PATH}/111`, json: page("111") },
    ]);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input()
    );

    expect(result.ok && result.value).toMatchObject({
      pageId: "111",
      version: 3,
      created: false,
    });
  });

  it("refuses a title that exists under another parent", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      parentRoute,
      {
        method: HttpMethod.Get,
        path: PAGES_PATH,
        json: {
          results: [page("111", { title: "LD-6 · PRD", parentId: "999" })],
        },
      },
    ]);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input()
    );

    expect(!result.ok && result.error.error).toContain(
      'A page titled "LD-6 · PRD" already exists elsewhere in ENG'
    );
    expect(fake.requestsTo(HttpMethod.Post, PAGES_PATH)).toHaveLength(0);
  });

  it("refuses a page outside the project's spaces", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      pageRoute(OTHER_PAGE_ID, { spaceId: OPS_SPACE_ID }),
    ]);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input({ page: OTHER_PAGE_ID })
    );

    expect(!result.ok && result.error.error).toContain("Not allowed");
    expect(fake.requestsTo(HttpMethod.Put, PAGES_RE)).toHaveLength(0);
  });
});

describe("publishMarkdownPage: overwrite guard", () => {
  function setup(authorId: string, version: number) {
    return createFakeConfluence([
      spacesRoute,
      pageRoute(PLAN_PAGE_ID, { version: { number: version, authorId } }),
      {
        method: HttpMethod.Put,
        path: `${PAGES_PATH}/${PLAN_PAGE_ID}`,
        json: page(PLAN_PAGE_ID),
      },
    ]);
  }

  it("refuses a page people edited after the recorded version", async () => {
    const fake = setup(REVIEWER_ID, 4);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input({
        page: PLAN_PAGE_ID,
        recordedVersions: new Map([[PLAN_PAGE_ID, 3]]),
      })
    );

    expect(!result.ok && result.error.error).toContain(
      "was edited on Confluence since AgentFlow last published it (version 4 by someone else)"
    );
    expect(fake.requestsTo(HttpMethod.Put, PAGES_RE)).toHaveLength(0);
  });

  it("refuses an unrecorded page last edited by someone else", async () => {
    const result = await publishMarkdownPage(
      createContext(setup(REVIEWER_ID, 2), { settings: SETTINGS }),
      input({ page: PLAN_PAGE_ID })
    );

    expect(result.ok).toBe(false);
  });

  it("passes with overwrite", async () => {
    const result = await publishMarkdownPage(
      createContext(setup(REVIEWER_ID, 4), { settings: SETTINGS }),
      input({ page: PLAN_PAGE_ID, overwrite: true })
    );

    expect(result.ok).toBe(true);
  });

  it("passes when the bot made the last version", async () => {
    const result = await publishMarkdownPage(
      createContext(setup(BOT_ID, 4), { settings: SETTINGS }),
      input({ page: PLAN_PAGE_ID })
    );

    expect(result.ok).toBe(true);
  });

  it("passes when the recorded version is the current one", async () => {
    const result = await publishMarkdownPage(
      createContext(setup(REVIEWER_ID, 3), { settings: SETTINGS }),
      input({
        page: PLAN_PAGE_ID,
        recordedVersions: new Map([[PLAN_PAGE_ID, 3]]),
      })
    );

    expect(result.ok).toBe(true);
  });
});

describe("publishMarkdownPage: attachments", () => {
  const uploadPath = `/wiki/rest/api/content/${NEW_PAGE_ID}/child/attachment`;
  const routes = [
    spacesRoute,
    parentRoute,
    emptyListRoute,
    { method: HttpMethod.Post, path: PAGES_PATH, json: page(NEW_PAGE_ID) },
    {
      method: HttpMethod.Put,
      path: uploadPath,
      json: {
        results: [
          {
            id: "att1",
            title: "login.png",
            extensions: { fileId: "file-1", mediaType: "image/png" },
            _links: { download: "/download/attachments/x/login.png" },
          },
        ],
      },
    },
    {
      method: HttpMethod.Put,
      path: `${PAGES_PATH}/${NEW_PAGE_ID}`,
      json: page(NEW_PAGE_ID),
    },
  ];

  it("uploads the PNG, then writes the body with its media as version 2", async () => {
    const fake = createFakeConfluence(routes);

    const result = await publishMarkdownPage(
      createContext(fake, { settings: SETTINGS }),
      input({ files: [PNG] })
    );

    expect(result.ok && result.value).toMatchObject({
      version: 2,
      attachments: ["login.png"],
    });
    expect(fake.requestsTo(HttpMethod.Put, uploadPath)).toHaveLength(1);
    const written = bodyOf(fake, "PUT", `${PAGES_PATH}/${NEW_PAGE_ID}`);
    expect(written.version.number).toBe(2);
    expect(written.body.value).toContain("mediaSingle");
  });

  it("writes the body again without media when Confluence answers 400", async () => {
    const fake = createFakeConfluence(routes);
    const bodies: string[] = [];
    const rejecting: typeof fetch = (url, init) => {
      const isBodyWrite =
        init?.method === HttpMethod.Put &&
        String(url).endsWith(`${PAGES_PATH}/${NEW_PAGE_ID}`);
      if (isBodyWrite) {
        bodies.push(String(init?.body));
      }
      if (isBodyWrite && bodies.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "bad media" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
        );
      }
      return fake.fetch(url, init);
    };
    const ctx = createContext(fake, { settings: SETTINGS });
    ctx.http = createProviderHttp(rejecting);

    const result = await publishMarkdownPage(ctx, input({ files: [PNG] }));

    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("mediaSingle");
    expect(bodies[1]).not.toContain("mediaSingle");
    expect(bodies[1]).toContain("Attachments");
  });
});

describe("readPageMarkdown", () => {
  it("returns Markdown, version and whether the bot edited last", async () => {
    const fake = createFakeConfluence([
      spacesRoute,
      pageRoute(PLAN_PAGE_ID, {
        version: {
          number: 5,
          authorId: BOT_ID,
          createdAt: "2026-10-15T09:00:00.000Z",
        },
      }),
    ]);

    const result = await readPageMarkdown(
      createContext(fake, { settings: SETTINGS }),
      PLAN_PAGE_ID,
      60_000
    );

    expect(result.ok && result.value).toMatchObject({
      pageId: PLAN_PAGE_ID,
      version: 5,
      space: "ENG",
      parentId: PARENT_PAGE_ID,
      truncated: false,
      lastEditedBy: {
        accountId: BOT_ID,
        byAgentFlow: true,
        at: "2026-10-15T09:00:00.000Z",
      },
    });
    expect(result.ok && result.value.markdown).toContain("## Tasks");
  });
});

describe("toConfluenceContext", () => {
  it("returns null for a bad config", () => {
    const ctx = createContext(createFakeConfluence([]), {
      config: { siteUrl: "not a url" },
    });

    expect(toConfluenceContext(ctx)).toBeNull();
  });

  it("returns the typed context for a valid one", () => {
    const ctx = createContext(createFakeConfluence([]));

    expect(toConfluenceContext(ctx)?.connection.config.siteUrl).toBe(SITE);
  });
});
