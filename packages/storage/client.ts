import "server-only";
import {
  S3Client,
  type S3ClientConfig,
  type StorageClass,
} from "@aws-sdk/client-s3";
import { keys } from "./keys";

/**
 * Shared S3-protocol clients for every object-storage caller (attachments,
 * transcripts, catalog assets, loop state).
 *
 * Two clients exist because SigV4 signs the Host header: server-side calls use
 * the internal endpoint (reachable from the API container), while presigned
 * URLs must carry the public endpoint the browser/desktop will actually hit.
 *
 * Checksums are only computed/validated when an operation requires them. The
 * AWS SDK otherwise adds CRC32 checksums to every request (and hoists an
 * empty-body CRC32 into presigned URLs), which S3-compatible servers such as
 * RustFS reject.
 */

/**
 * Wraps each S3 command (the api registers a tracing span). SDK-free seam: this
 * package has no telemetry dependency.
 */
export type StorageCommandObserver = <T>(
  command: { name: string; bucket?: string },
  run: () => Promise<T>
) => Promise<T>;

let storageCommandObserver: StorageCommandObserver | null = null;
let internalClient: S3Client | null = null;
let presignClient: S3Client | null = null;

export function getStorageClient(): S3Client {
  if (!internalClient) {
    const config = keys();
    internalClient = createClient(config.S3_ENDPOINT);
  }
  return internalClient;
}

export function getPresignClient(): S3Client {
  if (!presignClient) {
    const config = keys();
    presignClient = createClient(
      config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT
    );
  }
  return presignClient;
}

/**
 * Spread into a PutObject/CreateMultipartUpload input for cold data. Empty
 * unless `S3_COLD_STORAGE_CLASS` is configured.
 */
export function coldStorageClassInput(): { StorageClass?: StorageClass } {
  const storageClass = keys().S3_COLD_STORAGE_CLASS;
  return storageClass ? { StorageClass: storageClass as StorageClass } : {};
}

/** Sets (or clears) the observer; read at call time so existing clients are covered. */
export function setStorageCommandObserver(
  observer: StorageCommandObserver | null
): void {
  storageCommandObserver = observer;
}

/** Test-only: drop memoized clients so a test can change storage env vars. */
export function resetStorageClientsForTests(): void {
  internalClient = null;
  presignClient = null;
}

function createClient(endpoint: string | undefined): S3Client {
  const config = keys();
  const clientConfig: S3ClientConfig = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  if (endpoint) {
    clientConfig.endpoint = endpoint;
  }
  if (config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    };
  }
  const client = new S3Client(clientConfig);
  client.middlewareStack.add(
    (next, context) => (args) => {
      const observer = storageCommandObserver;
      if (!observer) {
        return next(args);
      }
      const input = args.input as { Bucket?: unknown } | undefined;
      return observer(
        {
          name: context.commandName ?? "UnknownCommand",
          bucket: typeof input?.Bucket === "string" ? input.Bucket : undefined,
        },
        () => next(args)
      );
    },
    { step: "initialize", name: "afStorageTelemetry" }
  );
  return client;
}
