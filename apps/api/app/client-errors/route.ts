import { clientErrorReportSchema } from "@repo/api/src/types/client-errors";
import { failure, success } from "@repo/api/src/types/common";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth/with-auth";
import { errorResponse, parseBody } from "@/lib/route-utils";
import { clientErrorService } from "./service";

const ACCEPTED_STATUS = 202;
const TOO_MANY_REQUESTS_STATUS = 429;
const MAX_REPORT_BYTES = 256 * 1024;

export const POST = withAuth<{ ok: true }, "/client-errors">(
  async ({ user }, request) => {
    try {
      const { body, errorResponse: parseError } = await parseBody(
        request,
        clientErrorReportSchema,
        { maxBytes: MAX_REPORT_BYTES }
      );
      if (parseError) {
        return parseError;
      }

      const result = clientErrorService.record(
        { userId: user.id, organizationId: user.organizationId },
        body
      );
      if (result.limited) {
        return NextResponse.json(failure("Too many client error reports"), {
          status: TOO_MANY_REQUESTS_STATUS,
        });
      }
      return NextResponse.json(success({ ok: true as const }), {
        status: ACCEPTED_STATUS,
      });
    } catch (error) {
      return errorResponse("Failed to record client errors", error);
    }
  }
);
