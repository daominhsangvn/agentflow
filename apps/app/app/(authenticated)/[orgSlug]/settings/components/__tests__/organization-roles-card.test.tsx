import {
  ORG_PERMISSION_CATALOGUE,
  OrgPermission,
} from "@repo/api/src/types/org-permissions";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationRolesCard } from "../organization-roles-card";

const { listRoles, createRole } = vi.hoisted(() => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
}));

vi.mock("@repo/auth/auth-client", () => ({
  authApi: {
    listRoles,
    createRole,
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
  },
}));

describe("OrganizationRolesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRole.mockResolvedValue({ data: {}, error: null });
  });

  it("does not render built-in roles", async () => {
    listRoles.mockResolvedValue({
      data: [
        { id: "1", role: "owner", permissions: [] },
        { id: "2", role: "admin", permissions: [] },
        { id: "3", role: "member", permissions: [] },
        {
          id: "4",
          role: "reviewer",
          permissions: [OrgPermission.MemberUpdate],
        },
      ],
      error: null,
    });
    render(<OrganizationRolesCard />);
    expect(await screen.findByText("reviewer")).toBeTruthy();
    expect(screen.queryByText("owner")).toBeNull();
    expect(screen.queryByText("admin")).toBeNull();
    expect(screen.queryByText("member")).toBeNull();
  });

  it("renders one checkbox per catalogue entry and creates with the selection", async () => {
    listRoles.mockResolvedValue({ data: [], error: null });
    render(<OrganizationRolesCard />);
    fireEvent.click(await screen.findByText("Create role"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(
      ORG_PERMISSION_CATALOGUE.length
    );
    fireEvent.change(screen.getByLabelText("Role name"), {
      target: { value: "reviewer" },
    });
    fireEvent.click(
      document.getElementById(
        `role-permission-${OrgPermission.InvitationCreate}`
      ) as HTMLElement
    );
    fireEvent.click(screen.getByText("Save role"));
    await waitFor(() =>
      expect(createRole).toHaveBeenCalledWith({
        role: "reviewer",
        permission: [OrgPermission.InvitationCreate],
      })
    );
  });
});
