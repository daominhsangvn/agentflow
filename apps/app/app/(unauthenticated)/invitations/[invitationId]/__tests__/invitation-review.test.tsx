import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InvitationReview,
  InvitationViewState,
  invitationViewState,
  roleLabel,
} from "../invitation-review";

const mocks = vi.hoisted(() => ({
  getInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
  rejectInvitation: vi.fn(),
}));

vi.mock("@repo/auth/auth-client", () => ({
  authApi: mocks,
  setActive: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@repo/auth/client", () => ({ useUser: () => ({ user: null }) }));
vi.mock("@repo/navigation/link", () => ({
  Link: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as string}</a>
  ),
}));

const DETAILS = {
  id: "i1",
  email: "a@b.co",
  role: "member",
  organizationId: "o1",
  organizationName: "Acme",
  organizationSlug: "acme",
  inviterEmail: "boss@b.co",
  status: "pending",
  expiresAt: "2026-12-01T00:00:00.000Z",
} as const;

describe("invitationViewState", () => {
  it("is loaded when data is present", () => {
    expect(invitationViewState({ data: DETAILS, error: null })).toBe(
      InvitationViewState.Loaded
    );
  });

  it("is mismatch on a 403", () => {
    expect(invitationViewState({ data: null, error: { status: 403 } })).toBe(
      InvitationViewState.Mismatch
    );
  });

  it("is invalid for not found or expired", () => {
    expect(invitationViewState({ data: null, error: { status: 400 } })).toBe(
      InvitationViewState.Invalid
    );
    expect(invitationViewState({ data: null, error: null })).toBe(
      InvitationViewState.Invalid
    );
  });
});

describe("roleLabel", () => {
  it("strips the org: prefix and capitalizes", () => {
    expect(roleLabel("org:admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});

describe("InvitationReview token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptInvitation.mockResolvedValue({ data: {}, error: null });
    mocks.rejectInvitation.mockResolvedValue({ data: {}, error: null });
  });

  it("passes the token on get and reject", async () => {
    mocks.getInvitation.mockResolvedValue({ data: DETAILS, error: null });
    render(<InvitationReview invitationId="i1" token="tok" />);
    await userEvent.click(await screen.findByText("Decline"));
    expect(mocks.getInvitation).toHaveBeenCalledWith("i1", "tok");
    expect(mocks.rejectInvitation).toHaveBeenCalledWith("i1", "tok");
  });

  it("passes the token on accept", async () => {
    mocks.getInvitation.mockResolvedValue({ data: DETAILS, error: null });
    render(<InvitationReview invitationId="i1" token="tok" />);
    await userEvent.click(await screen.findByText("Accept"));
    expect(mocks.acceptInvitation).toHaveBeenCalledWith("i1", "tok");
  });

  it("renders no longer valid on a 400", async () => {
    mocks.getInvitation.mockResolvedValue({
      data: null,
      error: { status: 400 },
    });
    render(<InvitationReview invitationId="i1" token={null} />);
    await waitFor(() =>
      expect(
        screen.getByText("This invitation is no longer valid.")
      ).toBeTruthy()
    );
  });
});
