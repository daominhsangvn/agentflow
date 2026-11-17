import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A minimal Azure DevOps organization for specs that only need a connection
 * to exist: it answers the calls the api makes when a connection is saved
 * (`_apis/connectionData`, an empty WIQL query) and lists its team projects.
 * Anything else is a 404, kept in `unhandled()` to explain a failure.
 */
export type FakeAzureDevOps = {
  /** Organization URL for the connection, e.g. http://127.0.0.1:53211/e2e-org. */
  url: string;
  unhandled(): readonly string[];
  close(): Promise<void>;
};

const HOST = "127.0.0.1";
const ORGANIZATION = "e2e-org";
const BOT_ID = "0b5a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const CONNECTION_DATA_RE = /\/_apis\/connectionData$/i;
const WIQL_RE = /\/_apis\/wit\/wiql$/i;
const PROJECTS_RE = /\/_apis\/projects$/i;
const PROJECT_RE = /\/_apis\/projects\/([^/]+)$/i;

export async function startFakeAzureDevOps(
  projects: readonly string[]
): Promise<FakeAzureDevOps> {
  const unhandled: string[] = [];
  const teamProjects = projects.map((name, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    name,
    state: "wellFormed",
  }));

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", `http://${HOST}`).pathname;
    const body = answer(decodeURIComponent(path), teamProjects);
    // Drain the request body (the WIQL query) before answering.
    request.resume();
    request.on("end", () => {
      if (body === null) {
        unhandled.push(`${request.method} ${path}`);
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "not found" }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${HOST}:${port}/${ORGANIZATION}`,
    unhandled: () => unhandled,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

type TeamProject = { id: string; name: string; state: string };

function answer(
  path: string,
  teamProjects: readonly TeamProject[]
): unknown | null {
  if (CONNECTION_DATA_RE.test(path)) {
    return {
      authenticatedUser: {
        id: BOT_ID,
        providerDisplayName: "E2E Bot",
        properties: { Account: { $value: "bot@e2e.test" } },
      },
    };
  }
  if (WIQL_RE.test(path)) {
    return { workItems: [] };
  }
  if (PROJECTS_RE.test(path)) {
    return { count: teamProjects.length, value: teamProjects };
  }
  const name = PROJECT_RE.exec(path)?.[1]?.toLowerCase();
  if (name) {
    return (
      teamProjects.find((project) => project.name.toLowerCase() === name) ??
      null
    );
  }
  return null;
}
