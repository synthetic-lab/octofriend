export function compactPrompt(conversationHistory: string) {
  return (
`Here is the conversation history to summarize: ${conversationHistory}

You are creating an internal context summary that will replace previous messages in the conversation history.

**IMPORTANT**: You are NOT continuing the conversation or responding to the user. You are creating a factual record of what has already happened. The user will likely never see this summary - it exists only to preserve context when the conversation resumes.

**Your task**: Analyze the conversation history that you read at the beginning of this message and create a detailed technical summary capturing all essential information for continuing work.

Before writing your summary, use <analysis> tags to organize your thinking:

<analysis>
[Chronologically review each part of the conversation and identify:
- The user's explicit requests and goals
- Actions that were taken and their outcomes  
- Technical decisions and their rationale
- Important code changes, file modifications, and command outputs
- Problems encountered and their resolutions
- Work that remains incomplete]
</analysis>

Then provide your summary in this structure:

<summary>
## Primary Request
[What the user asked for, in their own words if possible]

## Work Completed
[Specific actions taken, files modified, commands run - with results]

## Technical Context
- Architecture decisions made and why
- Patterns, frameworks, libraries being used (with examples)
- Commands that worked (exact syntax + relevant output)
- Commands that failed (what was tried, error messages, why it failed)
- Environment details (versions, dependencies, system info)

## Files Modified
For each file:
- **[Filename]**: [Why it's relevant] [What changed] [Current state]

## Work In Progress
[Specific description of incomplete work - which files, what state they're in, what was being attempted]

## Outstanding Issues
- Errors not yet resolved (include error messages)
- User requests acknowledged but not completed  
- Known blockers or risks

## Context for Resuming
[The most important things to know to pick up where this left off - reference specific files, line numbers, or error states]
</summary>

**Formatting rules**:
- Write in past tense ("The user requested...", "The assistant modified...", "The build failed...")
- Be specific: include file paths, function names, exact error messages, command syntax
- Capture enough detail that work could resume without re-reading the full history
- This is technical documentation, not a conversation
`
  );
}
