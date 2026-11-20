import type { Page, Request } from "@playwright/test";

/**
 * Answers GETs of the API's `path` (any query) with `data`, in the API's
 * envelope. `onRequest` sees every matched request, e.g. to record its query.
 */
export async function stubApiGet(
  page: Page,
  api: string,
  path: string,
  data: unknown,
  onRequest?: (request: Request) => void
) {
  const target = new URL(`${api}${path}`);
  await page.route(
    (url) => url.origin === target.origin && url.pathname === target.pathname,
    (route) => {
      if (route.request().method() !== "GET") {
        return route.fallback();
      }
      onRequest?.(route.request());
      return route.fulfill({ json: { success: true, data } });
    }
  );
}

/** Answers GETs of the API's `path` with a 500 in the API's error envelope. */
export async function stubApiFailure(page: Page, api: string, path: string) {
  const target = new URL(`${api}${path}`);
  await page.route(
    (url) => url.origin === target.origin && url.pathname === target.pathname,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 500,
            json: { success: false, error: "Internal error" },
          })
        : route.fallback()
  );
}
