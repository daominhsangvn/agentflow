import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { AuthMode } from "./auth-mode";

export const keys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    server: {
      AUTH_MODE: z
        .enum([AuthMode.Session, AuthMode.LocalTrusted])
        .default(AuthMode.Session)
        .optional(),
      // Where server code reaches apps/api for sessions and JWKS. Defaults to
      // NEXT_PUBLIC_API_URL; set it when the internal address differs (Docker).
      AUTH_API_URL: z.url().optional(),
      // Same variable as apps/api: "false" makes the deployment invite-only, so
      // the app hides sign-up and sends visitors to sign-in.
      AUTH_ALLOW_SIGN_UP: z.enum(["true", "false"]).optional(),
      // Same variable as apps/api: "true" lets signed-in users create additional orgs.
      AUTH_ALLOW_CREATE_ORGANIZATION: z.enum(["true", "false"]).optional(),
      // Microsoft Entra ID SSO (apps/api). On when client id and secret are both set.
      AUTH_MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
      AUTH_MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
      // Defaults to "common" (multi-tenant) when unset.
      AUTH_MICROSOFT_TENANT_ID: z.string().min(1).optional(),
    },
    client: {
      NEXT_PUBLIC_LOGO_URL: z.url().optional(),
    },
    runtimeEnv: {
      AUTH_MODE: process.env.AUTH_MODE,
      AUTH_API_URL: process.env.AUTH_API_URL,
      AUTH_ALLOW_SIGN_UP: process.env.AUTH_ALLOW_SIGN_UP,
      AUTH_ALLOW_CREATE_ORGANIZATION:
        process.env.AUTH_ALLOW_CREATE_ORGANIZATION,
      AUTH_MICROSOFT_CLIENT_ID: process.env.AUTH_MICROSOFT_CLIENT_ID,
      AUTH_MICROSOFT_CLIENT_SECRET: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
      AUTH_MICROSOFT_TENANT_ID: process.env.AUTH_MICROSOFT_TENANT_ID,
      NEXT_PUBLIC_LOGO_URL: process.env.NEXT_PUBLIC_LOGO_URL,
    },
  });
