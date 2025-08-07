TODO:

- [ ] Situational awareness: if it's a git repo, check the gitignore, and get a
  bunch of the directory heirarchy into context space automatically.
- [ ] Gemini API support: their "openai-compatible" API isn't complete enough
  to work with Octo
- [ ] Refactor History/IR for type safety: link back between i.e. tool calls,
  tool outputs, and original assistant messages
- [ ] Refactor menu system to use a stack of screens that can consistently be
  popped, rather than ad-hoc state linking. The stack entries are typed and
  each different state/internal-URI can have typed data associated with it.
- [ ] Link out directly to inference websites for API keys
- [ ] Allow Anthropic models to configure the thinking budget by tokens, rather
  than low/medium/high corresponding to specific budgets (2048/4096/8192)

# Launch blocking
nothing?
