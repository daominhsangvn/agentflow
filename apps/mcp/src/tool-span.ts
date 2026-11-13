import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  markSpanError,
  type SpanAttributes,
  withSpan,
} from "@repo/observability/span";
import { z } from "zod";

export const MCP_TOOL_SPAN_PREFIX = "mcp.tool ";

const SAFE_TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
export const UNKNOWN_TOOL_SPAN_NAME = "unknown";

export const McpSpanAttribute = { ToolName: "mcp.tool.name" } as const;

const errorResultSchema = z.object({ isError: z.literal(true) });

/** Runs one tool call in a span. Never records arguments or results. */
export function withToolSpan<T>(
  toolName: string,
  attributes: SpanAttributes,
  fn: () => Promise<T>
): Promise<T> {
  const safeName = SAFE_TOOL_NAME.test(toolName)
    ? toolName
    : UNKNOWN_TOOL_SPAN_NAME;
  return withSpan(
    `${MCP_TOOL_SPAN_PREFIX}${safeName}`,
    { [McpSpanAttribute.ToolName]: safeName, ...attributes },
    async (span) => {
      const result = await fn();
      if (errorResultSchema.safeParse(result).success) {
        markSpanError(span);
      }
      return result;
    }
  );
}

/** Wraps `server.registerTool` so every registered callback runs in a span. */
export function instrumentToolRegistration(
  server: McpServer,
  attributes: SpanAttributes
): void {
  const original = server.registerTool.bind(server);
  // The SDK's registerTool is generic over the schemas; the wrapper only forwards
  // arguments untouched, so a loose signature is cast back to the original.
  const wrapped = (name: string, config: unknown, cb: unknown) => {
    const callback = cb as (...args: unknown[]) => Promise<unknown>;
    const instrumented = (...args: unknown[]) =>
      withToolSpan(name, attributes, () => callback(...args));
    return (original as (...a: unknown[]) => unknown)(
      name,
      config,
      instrumented
    );
  };
  Reflect.set(server, "registerTool", wrapped);
}
