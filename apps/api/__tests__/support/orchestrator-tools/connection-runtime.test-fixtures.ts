type ConnectionRuntimeMocks = {
  attachFile: unknown;
  editOnItem: unknown;
  hasAttachFile: boolean;
  replyOnItem: unknown;
};

/** The project-connection runtime the orchestrator tools reply through. */
export function buildConnectionRuntime(mocks: ConnectionRuntimeMocks) {
  return {
    connection: {
      record: { id: "connection-1" },
      provider: {
        replyOnItem: mocks.replyOnItem,
        editOnItem: mocks.editOnItem,
        source: mocks.hasAttachFile
          ? { attachFile: mocks.attachFile }
          : undefined,
      },
      runtime: { secrets: {} },
    },
  };
}
