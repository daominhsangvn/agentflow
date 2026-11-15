import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  type ProjectAgentContact,
  ProjectAgentContactKind,
  type ProjectRunner,
} from "@repo/api/src/types/project-runners";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAgentContacts } from "../project-agent-contacts";

const PROJECT_ID = "0199a5f0-0000-7000-8000-0000000000d1";
const AGENT_ID = "0199a5f0-0000-7000-8000-0000000000c1";
const ADA_ID = "0199a5f0-0000-7000-8000-0000000000a1";
const GRACE_ID = "0199a5f0-0000-7000-8000-0000000000a2";
const NO_CONTACTS_RE = /No contacts: nobody is emailed/;

const mocks = vi.hoisted(() => ({
  saveMutate: vi.fn(),
  membersCall: vi.fn(),
}));

vi.mock("../../hooks/use-project-runners", () => ({
  useSaveProjectAgentContacts: () => ({
    mutate: mocks.saveMutate,
    isPending: false,
  }),
}));

vi.mock("@repo/app/users/hooks/use-users", () => ({
  useOrganizationUsers: (options: unknown) => {
    mocks.membersCall(options);
    return {
      data: [
        {
          id: ADA_ID,
          email: "ada@acme.dev",
          firstName: "Ada",
          lastName: "Lovelace",
          active: true,
        },
        {
          id: GRACE_ID,
          email: "grace@acme.dev",
          firstName: "Grace",
          lastName: "Hopper",
          active: true,
        },
      ],
    };
  },
}));

const ada: ProjectAgentContact = {
  id: "c1",
  kind: ProjectAgentContactKind.Member,
  userId: ADA_ID,
  email: "ada@acme.dev",
  name: "Ada Lovelace",
};
const ops: ProjectAgentContact = {
  id: "c2",
  kind: ProjectAgentContactKind.External,
  userId: null,
  email: "ops@acme.dev",
  name: null,
};

function runner(contacts: ProjectAgentContact[]): ProjectRunner {
  return {
    id: AGENT_ID,
    machineName: "runner-c1",
    isOnline: true,
    isSharedWithOrg: true,
    kind: AgentKind.Automatic,
    ownerName: null,
    capacity: 2,
    activeLoops: 0,
    tools: {},
    contacts,
  };
}

beforeEach(() => {
  mocks.saveMutate.mockReset();
  mocks.membersCall.mockReset();
});

describe("ProjectAgentContacts", () => {
  it("summarizes the contacts, or says nobody is emailed", () => {
    const { unmount } = render(
      <ProjectAgentContacts
        isAdmin={false}
        projectId={PROJECT_ID}
        runner={runner([ada, ops])}
      />
    );
    expect(
      screen.getByText(
        "Notified when a case needs a person: Ada Lovelace, ops@acme.dev"
      )
    ).toBeVisible();
    unmount();

    render(
      <ProjectAgentContacts
        isAdmin={false}
        projectId={PROJECT_ID}
        runner={runner([])}
      />
    );
    expect(screen.getByText(NO_CONTACTS_RE)).toBeVisible();
  });

  it("shows no editing button to non-admins", () => {
    render(
      <ProjectAgentContacts
        isAdmin={false}
        projectId={PROJECT_ID}
        runner={runner([ada])}
      />
    );
    expect(screen.queryByRole("button", { name: "Contacts" })).toBeNull();
  });

  it("does not load the members until the editor is opened", async () => {
    const user = userEvent.setup();
    render(
      <ProjectAgentContacts
        isAdmin
        projectId={PROJECT_ID}
        runner={runner([])}
      />
    );
    expect(mocks.membersCall).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Contacts" }));

    expect(mocks.membersCall).toHaveBeenCalledWith({ enabled: true });
  });

  it("adds a member", async () => {
    const user = userEvent.setup();
    render(
      <ProjectAgentContacts
        isAdmin
        projectId={PROJECT_ID}
        runner={runner([ops])}
      />
    );

    await user.click(screen.getByRole("button", { name: "Contacts" }));
    await user.click(screen.getByRole("combobox", { name: "Add a member" }));
    await user.click(screen.getByRole("option", { name: "Grace Hopper" }));

    expect(mocks.saveMutate).toHaveBeenCalledWith(
      {
        computeTargetId: AGENT_ID,
        contacts: [{ email: "ops@acme.dev" }, { userId: GRACE_ID }],
      },
      undefined
    );
  });

  it("adds an external email in lowercase", async () => {
    const user = userEvent.setup();
    render(
      <ProjectAgentContacts
        isAdmin
        projectId={PROJECT_ID}
        runner={runner([ada])}
      />
    );

    await user.click(screen.getByRole("button", { name: "Contacts" }));
    await user.type(
      screen.getByLabelText("External email"),
      "Ops@Acme.dev{Enter}"
    );

    expect(mocks.saveMutate).toHaveBeenCalledWith(
      {
        computeTargetId: AGENT_ID,
        contacts: [{ userId: ADA_ID }, { email: "ops@acme.dev" }],
      },
      { onSuccess: expect.any(Function) }
    );
  });

  it("keeps the typed email when the save fails and clears it on success", async () => {
    const user = userEvent.setup();
    render(
      <ProjectAgentContacts
        isAdmin
        projectId={PROJECT_ID}
        runner={runner([ada])}
      />
    );

    await user.click(screen.getByRole("button", { name: "Contacts" }));
    const input = screen.getByLabelText("External email");
    await user.type(input, "ops@acme.dev{Enter}");

    // The save has not resolved (or failed): the email is still there.
    expect(input).toHaveValue("ops@acme.dev");

    const options = mocks.saveMutate.mock.calls[0]?.[1] as {
      onSuccess: () => void;
    };
    await act(async () => options.onSuccess());
    expect(input).toHaveValue("");
  });

  it("shows an error for an invalid email and does not save", async () => {
    const user = userEvent.setup();
    render(
      <ProjectAgentContacts
        isAdmin
        projectId={PROJECT_ID}
        runner={runner([])}
      />
    );

    await user.click(screen.getByRole("button", { name: "Contacts" }));
    await user.type(screen.getByLabelText("External email"), "nope{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write an email address"
    );
    expect(mocks.saveMutate).not.toHaveBeenCalled();
  });

  it("removes a contact", async () => {
    const user = userEvent.setup();
    render(
      <ProjectAgentContacts
        isAdmin
        projectId={PROJECT_ID}
        runner={runner([ada, ops])}
      />
    );

    await user.click(screen.getByRole("button", { name: "Contacts" }));
    await user.click(
      screen.getByRole("button", { name: "Remove Ada Lovelace" })
    );

    expect(mocks.saveMutate).toHaveBeenCalledWith(
      {
        computeTargetId: AGENT_ID,
        contacts: [{ email: "ops@acme.dev" }],
      },
      undefined
    );
  });
});
