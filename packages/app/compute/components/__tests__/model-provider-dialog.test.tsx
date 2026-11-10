import {
  ClaudeCodeVersionChannel,
  type ComputeTargetModelProvider,
  ModelProviderMode,
} from "@repo/api/src/types/compute-target-model-provider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelProviderDialog } from "../model-provider-dialog";

const mocks = vi.hoisted(() => ({
  provider: null as ComputeTargetModelProvider | null,
  mutate: vi.fn(),
}));

vi.mock("../../hooks/use-compute-target-model-provider", () => ({
  useComputeTargetModelProvider: () => ({ data: mocks.provider, error: null }),
  useUpdateComputeTargetModelProvider: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
}));

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.provider = {
    mode: ModelProviderMode.Machine,
    baseUrl: null,
    model: null,
    env: {},
    token: { isSet: false, lastFour: null },
    caCertificate: null,
    claudeCodeVersion: ClaudeCodeVersionChannel.Latest,
  };
});

describe("ModelProviderDialog Claude Code version", () => {
  it("shows latest by default and saves it", () => {
    renderDialog();

    expect(versionInput()).toHaveValue(ClaudeCodeVersionChannel.Latest);
    fireEvent.click(saveButton());

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: ModelProviderMode.Machine,
        claudeCodeVersion: ClaudeCodeVersionChannel.Latest,
      }),
      expect.anything()
    );
  });

  it("saves an exact release, and latest for a blank field", () => {
    renderDialog();

    fireEvent.change(versionInput(), { target: { value: " 2.1.290 " } });
    fireEvent.click(saveButton());
    fireEvent.change(versionInput(), { target: { value: "" } });
    fireEvent.click(saveButton());

    expect(
      mocks.mutate.mock.calls.map(([input]) => input.claudeCodeVersion)
    ).toEqual(["2.1.290", ClaudeCodeVersionChannel.Latest]);
  });

  it("refuses a value the runner cannot install", () => {
    renderDialog();

    fireEvent.change(versionInput(), { target: { value: "v2.1" } });

    expect(
      screen.getByText("Use latest or a version such as 2.1.296")
    ).toBeInTheDocument();
    expect(versionInput()).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
  });
});

describe("ModelProviderDialog CA certificate", () => {
  const PEM =
    "-----BEGIN CERTIFICATE-----\nMIIBroot\n-----END CERTIFICATE-----";
  const customProvider = (): ComputeTargetModelProvider => ({
    ...(mocks.provider as ComputeTargetModelProvider),
    mode: ModelProviderMode.Custom,
    baseUrl: "https://claude.example.com",
  });

  it("uploads a PEM file and saves it", async () => {
    mocks.provider = customProvider();
    renderDialog();

    fireEvent.change(certificateInput(), {
      target: { files: [new File([PEM], "ca_179.crt")] },
    });

    expect(await screen.findByText("ca_179.crt · 1 certificate")).toBeVisible();
    fireEvent.click(saveButton());
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        caCertificate: { fileName: "ca_179.crt", pem: PEM },
      }),
      expect.anything()
    );
  });

  it("refuses a file that is not PEM", async () => {
    mocks.provider = customProvider();
    renderDialog();

    fireEvent.change(certificateInput(), {
      target: { files: [new File(["binary"], "ca.der")] },
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          "Upload a PEM certificate (-----BEGIN CERTIFICATE----- …)"
        )
      ).toBeVisible()
    );
  });

  it("keeps the stored certificate unless it is removed", () => {
    mocks.provider = {
      ...customProvider(),
      caCertificate: { fileName: "ca.pem", certificateCount: 2 },
    };
    renderDialog();

    expect(screen.getByText("ca.pem · 2 certificates")).toBeVisible();
    fireEvent.click(saveButton());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(saveButton());

    expect(
      mocks.mutate.mock.calls.map(([input]) => input.caCertificate)
    ).toEqual([undefined, null]);
  });
});

function certificateInput(): HTMLElement {
  return screen.getByLabelText("CA certificate (optional)");
}

function renderDialog() {
  render(
    <ModelProviderDialog
      computeTargetId="0199a5f0-0000-7000-8000-0000000000c1"
      machineName="runner-1"
      onClose={vi.fn()}
    />
  );
}

function versionInput() {
  return screen.getByLabelText("Claude Code version");
}

function saveButton() {
  return screen.getByRole("button", { name: "Save" });
}
