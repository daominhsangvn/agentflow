import { AsyncLocalStorage } from "node:async_hooks";

// Marks the single in-flight sign-up started by `createFirstAdminAccount` so it
// alone bypasses `AUTH_ALLOW_SIGN_UP=false`; other requests never see the store.
const firstAdminSignUp = new AsyncLocalStorage<true>();

/** True only inside the callback passed to `runAsFirstAdminSignUp`. */
export function isFirstAdminSignUp(): boolean {
  return firstAdminSignUp.getStore() === true;
}

export function runAsFirstAdminSignUp<T>(fn: () => T): T {
  return firstAdminSignUp.run(true, fn);
}
