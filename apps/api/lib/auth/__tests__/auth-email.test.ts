import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mail-transport", () => ({
  isMailConfigured: () => true,
  sendMail: sendMailMock,
}));

import { sendInvitationEmail } from "@/lib/auth/auth-email";

describe("sendInvitationEmail", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-links");
  });

  it("links to the invitation review page with the email", async () => {
    await sendInvitationEmail({
      invitationId: "inv-1",
      email: "new@example.test",
      organizationName: "Acme",
      inviterName: "Ada",
      role: "admin",
    });

    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.to).toBe("new@example.test");
    expect(mail.text).toContain("/invitations/inv-1?token=");
    expect(mail.text).toContain("email=new%40example.test");
    expect(mail.text).toContain("as admin");
  });
});
