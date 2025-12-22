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
`You are creating a compressed summary of a conversation history that will replace the original messages in the context window.

**Your role**: You are NOT responding to the user. You are NOT continuing the conversation. You are ONLY creating an internal summary document that will be inserted into the context to preserve information about what has already happened.

**Critical constraints**:
- This summary will REPLACE all previous messages when the conversation resumes
- The user will likely NOT see this summary - it's purely for context preservation
- You must write in third-person past tense (e.g., "The user requested X", "The tool call implemented Y")
- Do NOT include greetings, signoffs, or conversational language
- Do NOT say things like "I'll help you with..." or "Let me know if..."
- Do NOT attempt to continue or complete any in-progress work
- Simply document what has already occurred

**Required sections**:

## Current State

- What task the user requested (exact wording if possible)
- What has been completed so far
- What was being worked on when the conversation was paused (incomplete work)
- What remains to be done (specific next steps derived from the conversation)

## Files & Changes

- Files that were created or modified (with brief description of changes)
- Files that were read or analyzed (why they were relevant)
- Key files mentioned but not yet modified
- Specific file paths and line numbers for important code locations

## Technical Context

- Architecture decisions that were made and their rationale
- Patterns and conventions being followed (with examples from the conversation)
- Libraries, frameworks, and tools being used
- Commands that were executed successfully (exact commands with output context)
- Commands that failed (what was attempted and why it failed)
- Environment details (language versions, dependencies, system info)

## Strategy & Approach

- The overall approach being taken to solve the problem
- Why this approach was chosen (if discussed)
- Key insights, discoveries, or gotchas that were identified
- Assumptions that were made
- Any blockers, risks, or open questions that were raised

## Next Steps

- Concrete, specific actions that need to happen next
- Reference specific files, functions, or line numbers
- Include enough detail that work could resume without re-reading the entire history

**Format requirements**:
- Write in past tense, third person (chronicle what happened)
- Be factual and detailed, not conversational
- Think of this as technical documentation, not a message
- Include specific details: file names, function names, error messages, exact commands
- Capture the state of the work, not your intentions going forward

**Length**: No limit. Prioritize completeness over brevity. Missing context cannot be recovered.

Here is the conversation history that you are summarizing, read the following very carefully:

${conversationHistory}
`
  );
}