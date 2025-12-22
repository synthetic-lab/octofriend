export function compactPrompt(conversationHistory: string) {
  return (
`You are creating a compressed summary of a conversation history that will replace the original messages in the context window.

**Your role**: You are NOT responding to the user. You are NOT continuing the conversation. You are ONLY creating an internal summary document that will be inserted into the context to preserve information about what has already happened.

**Critical constraints**:
- This summary will REPLACE all previous messages when the conversation resumes
- The user will NOT see this summary - it's purely for context preservation
- You must write in third-person past tense (e.g., "The user requested X", "The assistant implemented Y")
- Do NOT include greetings, signoffs, or conversational language
- Do NOT say things like "I'll help you with..." or "Let me know if..."
- Do NOT attempt to continue or complete any in-progress work
- Simply document what has already occurred

**Required sections**:

## Current State

- What task the user requested (exact wording if possible)
- What has been completed so far
- What was in progress when the conversation paused (incomplete/partial work)
- What was explicitly discussed as remaining work (not your inference, but what was actually mentioned in the conversation)

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

## Unfinished Work

- What was explicitly stated as still needing to be done
- Work that was started but not completed (with specifics: which file, which function, what state it's in)
- Issues or errors that were encountered but not yet resolved
- User requests that were acknowledged but not yet addressed

**Format requirements**:
- Write in past tense, third person (chronicle what happened)
- Be factual and detailed, not conversational
- Think of this as technical documentation, not a message
- Include specific details: file names, function names, error messages, exact commands
- Capture the state of the work as it was left, not predictions about what should happen

**Length**: No limit. Prioritize completeness over brevity. Missing context cannot be recovered.

Here is the conversation history that you are summarizing, read the following very carefully:

${conversationHistory}
`
  );
}