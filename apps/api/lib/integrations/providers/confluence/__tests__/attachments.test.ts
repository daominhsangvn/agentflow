import { describe, expect, it } from "vitest";
import {
  attachmentBlocks,
  type PageAttachment,
  uploadPageAttachment,
} from "@/lib/integrations/providers/confluence/attachments";
import { HttpMethod } from "@/lib/integrations/types";
import {
  createContext,
  createFakeConfluence,
  PLAN_PAGE_ID,
  SITE,
  TOKEN,
} from "./confluence.test-fixtures";

/** Page attachments: the multipart upload and the ADF blocks that show them. */

const UPLOAD_PATH = `/wiki/rest/api/content/${PLAN_PAGE_ID}/child/attachment`;
const FILE = {
  name: "login.png",
  contentType: "image/png",
  bytes: new Uint8Array([1, 2, 3]),
};
const UPLOADED = {
  id: "att9001",
  title: "login.png",
  extensions: { fileId: "file-uuid-1", mediaType: "image/png" },
  _links: { download: "/download/attachments/1638401/login.png" },
};

describe("uploadPageAttachment", () => {
  it("PUTs multipart with the XSRF header and maps the attachment", async () => {
    const fake = createFakeConfluence([
      {
        method: HttpMethod.Put,
        path: UPLOAD_PATH,
        json: { results: [UPLOADED] },
      },
    ]);
    const forms: Array<FormData | undefined> = [];
    const ctx = createContext(fake);
    const http = ctx.http;
    ctx.http = {
      ...http,
      request: (request) => {
        forms.push(request.body instanceof FormData ? request.body : undefined);
        return http.request(request);
      },
    };

    const result = await uploadPageAttachment(ctx, PLAN_PAGE_ID, FILE);

    expect(result).toEqual({
      ok: true,
      value: {
        id: "att9001",
        name: "login.png",
        contentType: "image/png",
        fileId: "file-uuid-1",
        url: `${SITE}/wiki/download/attachments/1638401/login.png`,
      },
    });
    const [request] = fake.requestsTo(HttpMethod.Put, UPLOAD_PATH);
    expect(request?.headers.get("x-atlassian-token")).toBe("no-check");
    const file = forms[0]?.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("login.png");
    expect(forms[0]?.get("minorEdit")).toBe("true");
  });

  it("accepts a single-object response", async () => {
    const fake = createFakeConfluence([
      { method: HttpMethod.Put, path: UPLOAD_PATH, json: UPLOADED },
    ]);

    const result = await uploadPageAttachment(
      createContext(fake),
      PLAN_PAGE_ID,
      FILE
    );

    expect(result.ok && result.value.fileId).toBe("file-uuid-1");
  });

  it("names the file in a failure and never the token", async () => {
    const fake = createFakeConfluence([
      { method: HttpMethod.Put, path: UPLOAD_PATH, status: 403, json: {} },
    ]);

    const result = await uploadPageAttachment(
      createContext(fake),
      PLAN_PAGE_ID,
      FILE
    );

    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.error.error;
    expect(message).toContain("login.png");
    expect(message).not.toContain(TOKEN);
  });
});

describe("attachmentBlocks", () => {
  const files: PageAttachment[] = [
    {
      id: "1",
      name: "login.png",
      contentType: "image/png",
      fileId: "file-uuid-1",
      url: "https://x/1",
    },
    {
      id: "2",
      name: "log.txt",
      contentType: "text/plain",
      fileId: "file-uuid-2",
      url: "https://x/2",
    },
  ];

  it("shows each image as media and lists every file", () => {
    const blocks = attachmentBlocks(PLAN_PAGE_ID, files, { media: true });

    expect(blocks.map((block) => block.type)).toEqual([
      "mediaSingle",
      "paragraph",
      "bulletList",
    ]);
    expect(blocks[0]).toMatchObject({
      content: [
        {
          attrs: {
            type: "file",
            id: "file-uuid-1",
            collection: `contentId-${PLAN_PAGE_ID}`,
          },
        },
      ],
    });
    const list = blocks[2];
    expect(list?.type === "bulletList" && list.content).toHaveLength(2);
  });

  it("gives only the list without media, and nothing without files", () => {
    expect(
      attachmentBlocks(PLAN_PAGE_ID, files, { media: false }).map(
        (block) => block.type
      )
    ).toEqual(["paragraph", "bulletList"]);
    expect(attachmentBlocks(PLAN_PAGE_ID, [], { media: true })).toEqual([]);
  });
});
