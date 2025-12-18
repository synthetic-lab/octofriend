import { t, toTypescript } from "structural";

export const CompactSuccess = t.subtype({
  success: t.value(true),
  summary: t.str,
});
export const CompactFailure = t.subtype({
  success: t.value(false),
});
export const CompactResponse = CompactSuccess.or(CompactFailure);

export function compactPrompt(conversationHistory: string) {
  return (
`You are summarizing a conversation to preserve context for continuing work later.

**Critical**: This summary will be the ONLY context available when the conversation resumes. Assume all previous messages will be lost. Be thorough.

**Required sections**:

## Current State

- What task is being worked on (exact user request)
- Current progress and what's been completed
- What's being worked on right now (incomplete work)
- What remains to be done (specific next steps, not vague)

## Files & Changes

- Files that were modified (with brief description of changes)
- Files that were read/analyzed (why they're relevant)
- Key files not yet touched but will need changes
- File paths and line numbers for important code locations

## Technical Context

- Architecture decisions made and why
- Patterns being followed (with examples)
- Libraries/frameworks being used
- Commands that worked (exact commands with context)
- Commands that failed (what was tried and why it didn't work)
- Environment details (language versions, dependencies, etc.)

## Strategy & Approach

- Overall approach being taken
- Why this approach was chosen over alternatives
- Key insights or gotchas discovered
- Assumptions made
- Any blockers or risks identified

## Next Steps

Be specific. For example, don't write "implement authentication", but instead find a way to talk about what files were changed, etc.
**Tone**: Write as if briefing a teammate taking over mid-task. Include everything they'd need to continue without asking questions.

**Length**: No limit. Err on the side of too much detail rather than too little. Critical context is worth the tokens.

Here is the conversation history that you are compacting, read the following very carefully:

${conversationHistory}
`
  );
}
