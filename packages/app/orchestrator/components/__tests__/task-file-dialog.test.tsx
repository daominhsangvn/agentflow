import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskFileDialog } from "../task-file-dialog";

const fileQuery = vi.fn();
const downloadMutate = vi.fn();

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useOrchestratorTaskFile: (input: unknown) => fileQuery(input),
  useDownloadOrchestratorTaskFile: () => ({
    mutate: downloadMutate,
    isPending: false,
  }),
}));

vi.mock("../task-file-viewer", () => ({
  TaskFileViewer: ({ fileName }: { fileName: string }) => (
    <div data-testid="task-file-viewer">{fileName}</div>
  ),
}));

const onOpenChange = vi.fn();

function renderDialog(name: string, open = true) {
  return render(
    <TaskFileDialog
      caseId="case-1"
      name={name}
      onOpenChange={onOpenChange}
      open={open}
      taskId="task-1"
    />
  );
}

describe("TaskFileDialog", () => {
  beforeEach(() => {
    fileQuery.mockReset();
    downloadMutate.mockReset();
    onOpenChange.mockReset();
    fileQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("does not enable the request while closed", () => {
    renderDialog("a.md", false);

    expect(fileQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it.each([
    ["notes/a.md", "a.md"],
    ["b.markdown", "b.markdown"],
    ["shot.png", "shot.png"],
    ["docs/spec.docx", "spec.docx"],
    ["report.pdf", "report.pdf"],
  ])("renders %s in the viewer", async (name, base) => {
    fileQuery.mockReturnValue({
      data: new Blob(["x"]),
      isPending: false,
      isError: false,
    });
    renderDialog(name);

    const viewer = await screen.findByTestId("task-file-viewer");
    expect(viewer.textContent).toBe(base);
    expect(fileQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it("has a top bar with Download and Close", () => {
    renderDialog("data.bin");

    const bar = within(screen.getByTestId("task-file-dialog-bar"));
    expect(bar.getByRole("button", { name: "Download" })).toBeDefined();
    fireEvent.click(bar.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("is sized to 90% of the viewport", () => {
    renderDialog("data.bin");

    const content = screen.getByTestId("task-file-dialog");
    expect(content.className).toContain("h-[90vh]");
    expect(content.className).toContain("w-[90vw]");
  });

  it("says there is no preview for an unknown type and downloads", () => {
    renderDialog("data.bin");

    expect(screen.getByText("No preview for this file type")).toBeDefined();
    expect(fileQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    fireEvent.click(
      within(screen.getByTestId("task-file-dialog-bar")).getByRole("button", {
        name: "Download",
      })
    );
    expect(downloadMutate).toHaveBeenCalledWith({
      caseId: "case-1",
      taskId: "task-1",
      name: "data.bin",
    });
  });
});
