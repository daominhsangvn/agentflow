import { fireEvent, render, screen } from "@testing-library/react";
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

function renderDialog(name: string, open = true) {
  return render(
    <TaskFileDialog
      caseId="case-1"
      name={name}
      onOpenChange={vi.fn()}
      open={open}
      taskId="task-1"
    />
  );
}

describe("TaskFileDialog", () => {
  beforeEach(() => {
    fileQuery.mockReset();
    downloadMutate.mockReset();
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

  it("renders a markdown file as a heading", async () => {
    fileQuery.mockReturnValue({
      data: new Blob(["# Title"]),
      isPending: false,
      isError: false,
    });
    renderDialog("notes/a.md");

    expect(await screen.findByRole("heading", { name: "Title" })).toBeDefined();
  });

  it("renders an image file as an img", () => {
    fileQuery.mockReturnValue({
      data: new Blob(["x"], { type: "image/png" }),
      isPending: false,
      isError: false,
    });
    renderDialog("shot.png");

    expect(document.querySelector("img")).not.toBeNull();
  });

  it("says there is no preview for an unknown type and downloads", () => {
    renderDialog("data.bin");

    expect(screen.getByText("No preview for this file type")).toBeDefined();
    expect(fileQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadMutate).toHaveBeenCalledWith({
      caseId: "case-1",
      taskId: "task-1",
      name: "data.bin",
    });
  });
});
