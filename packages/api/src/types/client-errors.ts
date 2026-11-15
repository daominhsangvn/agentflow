import { z } from "zod";

export const ClientErrorKind = {
  Log: "log",
  Unhandled: "unhandled",
  Rejection: "rejection",
} as const;
export type ClientErrorKind =
  (typeof ClientErrorKind)[keyof typeof ClientErrorKind];

/** Levels the browser reporter forwards (mirrors `LogLevel.Error` / `LogLevel.Warn`). */
export const ClientErrorLevel = { Error: "error", Warn: "warn" } as const;
export type ClientErrorLevel =
  (typeof ClientErrorLevel)[keyof typeof ClientErrorLevel];

export const CLIENT_ERROR_MAX_RECORDS_PER_REPORT = 20;
const MAX_ATTRIBUTE_KEYS = 20;

export const clientErrorRecordSchema = z.object({
  kind: z.enum([
    ClientErrorKind.Log,
    ClientErrorKind.Unhandled,
    ClientErrorKind.Rejection,
  ]),
  level: z.enum([ClientErrorLevel.Error, ClientErrorLevel.Warn]),
  message: z.string().max(1024),
  name: z.string().max(200).optional(),
  stack: z.string().max(4096).optional(),
  path: z.string().max(512),
  digest: z.string().max(100).optional(),
  attributes: z
    .record(
      z.string().max(64),
      z.union([z.string().max(256), z.number(), z.boolean()])
    )
    .refine((value) => Object.keys(value).length <= MAX_ATTRIBUTE_KEYS, {
      message: `At most ${MAX_ATTRIBUTE_KEYS} attributes`,
    })
    .optional(),
});

export const clientErrorReportSchema = z.object({
  records: z
    .array(clientErrorRecordSchema)
    .min(1)
    .max(CLIENT_ERROR_MAX_RECORDS_PER_REPORT),
});

export type ClientErrorRecord = z.infer<typeof clientErrorRecordSchema>;
export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;
