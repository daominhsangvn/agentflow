import { describe, expect, test } from "vitest";
import {
  ClaudeCodeVersionChannel,
  claudeCodeVersionSchema,
  MODEL_PROVIDER_CA_PEM_ENV_KEY,
  ModelProviderMode,
  modelProviderEnvSchema,
  updateComputeTargetModelProviderInputSchema,
} from "./compute-target-model-provider";

describe("claudeCodeVersionSchema", () => {
  test("accepts latest and exact releases", () => {
    for (const value of [
      ClaudeCodeVersionChannel.Latest,
      "2.1.296",
      "10.0.1",
      "2.2.0-beta.1",
    ]) {
      expect(claudeCodeVersionSchema.parse(value)).toBe(value);
    }
    expect(claudeCodeVersionSchema.parse(" 2.1.290 ")).toBe("2.1.290");
  });

  test("refuses anything that is not an installer target or a plain file name", () => {
    for (const value of [
      "",
      "stable",
      "2.1",
      "v2.1.296",
      "2.1.296/../../bin",
      "../2.1.296",
      "2.1.296; rm -rf ~",
      "2.1.296 --force",
      "LATEST",
    ]) {
      expect(claudeCodeVersionSchema.safeParse(value).success, value).toBe(
        false
      );
    }
  });
});

describe("updateComputeTargetModelProviderInputSchema", () => {
  test("defaults the Claude Code version to latest", () => {
    const input = updateComputeTargetModelProviderInputSchema.parse({
      mode: ModelProviderMode.Machine,
    });

    expect(input.claudeCodeVersion).toBe(ClaudeCodeVersionChannel.Latest);
  });

  test("keeps an exact version and rejects an invalid one", () => {
    expect(
      updateComputeTargetModelProviderInputSchema.parse({
        mode: ModelProviderMode.Machine,
        claudeCodeVersion: "2.1.290",
      }).claudeCodeVersion
    ).toBe("2.1.290");
    expect(
      updateComputeTargetModelProviderInputSchema.safeParse({
        mode: ModelProviderMode.Machine,
        claudeCodeVersion: "2.1.290 && curl evil",
      }).success
    ).toBe(false);
  });
});

describe("proxy variables and CA certificate", () => {
  const PEM =
    "-----BEGIN CERTIFICATE-----\nMIIBroot\n-----END CERTIFICATE-----";
  const custom = {
    mode: ModelProviderMode.Custom,
    baseUrl: "https://claude.example.com",
  };

  test("accepts the proxy variables and refuses NODE_EXTRA_CA_CERTS as a variable", () => {
    expect(
      updateComputeTargetModelProviderInputSchema.safeParse({
        ...custom,
        env: {
          HTTPS_PROXY: "http://172.16.0.1:8090",
          HTTP_PROXY: "http://172.16.0.1:8090",
          NO_PROXY: "localhost,127.0.0.1,github.com",
          ANTHROPIC_CUSTOM_HEADERS: "X-Api-Key:pk_test",
        },
      }).success
    ).toBe(true);
    expect(
      updateComputeTargetModelProviderInputSchema.safeParse({
        ...custom,
        env: { NODE_EXTRA_CA_CERTS: "/Users/me/ca.crt" },
      }).success
    ).toBe(false);
  });

  test("accepts a PEM certificate and refuses other files", () => {
    expect(
      updateComputeTargetModelProviderInputSchema.safeParse({
        ...custom,
        caCertificate: { fileName: "ca.crt", pem: PEM },
      }).success
    ).toBe(true);
    expect(
      updateComputeTargetModelProviderInputSchema.safeParse({
        ...custom,
        caCertificate: { fileName: "ca.der", pem: "binary" },
      }).success
    ).toBe(false);
  });

  test("lets the loop environment carry the PEM but not other variables", () => {
    expect(
      modelProviderEnvSchema.safeParse({
        [MODEL_PROVIDER_CA_PEM_ENV_KEY]: PEM.repeat(10),
        HTTPS_PROXY: "http://172.16.0.1:8090",
      }).success
    ).toBe(true);
    expect(
      modelProviderEnvSchema.safeParse({ NODE_OPTIONS: "--require x" }).success
    ).toBe(false);
  });
});
