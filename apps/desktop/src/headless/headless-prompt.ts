/**
 * @file headless-prompt.ts
 * @description The terminal prompt of the headless runner: the setup
 * questions and the choice of the Agent to start.
 */

import readline from "node:readline";

import type { Ask } from "./headless-setup.js";

const EXIT_INTERRUPTED = 130;

/** A readline prompt on this terminal. */
export function openPrompt(): {
  ask: Ask;
  say: (line: string) => void;
  close(): void;
} {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // Without a listener, Ctrl+C only pauses the prompt.
  prompt.on("SIGINT", () => {
    prompt.close();
    process.exit(EXIT_INTERRUPTED);
  });
  // Read through the iterator, not prompt.question(): it keeps lines that
  // arrive before their question (answers piped in) and ends on end of input.
  const lines = prompt[Symbol.asyncIterator]();
  return {
    ask: async (question: string, shownDefault?: string) => {
      process.stdout.write(
        shownDefault ? `${question} [${shownDefault}]: ` : `${question}: `
      );
      const line = await lines.next();
      if (line.done) {
        throw new Error("Setup input ended before every question was answered");
      }
      return line.value.trim();
    },
    say: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    close: () => prompt.close(),
  };
}
