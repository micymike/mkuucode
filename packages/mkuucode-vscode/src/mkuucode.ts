import type { Config } from "@opencode-ai/sdk/client"

export const AGENT_ID = "mkuucode"

export const SYSTEM_PROMPT = `You are MkuuCode, a careful senior software engineer embedded in a developer's editor. You operate through the OpenCode agent engine and its tools. You are not an autocomplete model; you reason, plan, and verify before and after you act.

Non-negotiable working rules:
- Understand the existing code before editing anything. Read the relevant files and the repository's AGENTS.md / conventions first.
- Prefer modifying existing abstractions over creating unnecessary ones.
- Keep implementations simple and minimal. Do not introduce speculative structure.
- Avoid adding dependencies unless a dependency is genuinely necessary.
- Do not rewrite unrelated code. Scope changes to the ask.
- Explain architectural or high-impact changes before making them, and propose the plan to the user when there is more than one reasonable approach.
- Run the relevant tests after making modifications. Follow the repository's test and typecheck commands (e.g. bun typecheck, bun test in the affected package).
- Never claim code works without verifying it yourself.
- Review the final diff before finishing and clean up anything unintended.
- Prioritize security and correctness over speed.
- Follow the repository's existing coding conventions and style guide.

When a request touches multiple independent concerns, state your plan briefly (understand -> plan -> implement -> verify -> review) and then execute it step by step.`

export const COMMANDS: Record<string, { label: string; instruction: (arg: string) => string }> = {
  "/plan": {
    label: "Plan",
    instruction: (arg) =>
      `Produce an implementation plan for this task. Do NOT edit any files. Analyze the code, break the work into steps, and explain what you would change and why.\n\n${arg}`,
  },
  "/review": {
    label: "Review",
    instruction: (arg) =>
      `Review the current changes carefully. Read the diff, identify correctness/security/performance/quality issues, and report concrete findings with file references. Do NOT edit any files unless asked.\n\n${arg}`,
  },
  "/test": {
    label: "Test",
    instruction: (arg) =>
      `Run the relevant tests for the affected code and report results. Detect test failures, diagnose their cause, and only then fix the underlying problem. Do not mask failures.\n\n${arg}`,
  },
  "/explain": {
    label: "Explain",
    instruction: (arg) =>
      `Explain the selected code clearly and concisely: its purpose, how it fits into the rest of the codebase, and any non-obvious behavior. Do not edit anything.\n\n${arg}`,
  },
  "/fix": {
    label: "Fix",
    instruction: (arg) =>
      `Investigate the current problem, root-cause it, and fix it. Keep the change minimal, preserve existing behavior elsewhere, and verify the fix. Review your own diff.\n\n${arg}`,
  },
}

export function mkuucodeConfig(): Config {
  return {
    agent: {
      [AGENT_ID]: {
        prompt: SYSTEM_PROMPT,
        mode: "primary",
        description: "MkuuCode senior software engineer agent (Copilot-style assistant)",
        tools: {
          // Explicitly enable the built-in tools MkuuCode leans on. Keys are
          // tool IDs; leaving one out retains the server default.
          bash: true,
          edit: true,
          read: true,
          glob: true,
          grep: true,
          webfetch: true,
        },
        permission: {
          edit: "allow",
          bash: "allow",
          webfetch: "ask",
          external_directory: "ask",
        },
      },
    },
  }
}

export function commandify(raw: string): string {
  const trimmed = raw.trim()
  const slash = trimmed.match(/^\/(plan|review|test|explain|fix)\b/i)?.[1].toLowerCase()
  if (!slash) return raw
  const arg = trimmed.slice(slash.length + 1).trim()
  return COMMANDS[`/${slash}`]!.instruction(arg)
}