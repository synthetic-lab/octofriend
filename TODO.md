TODO:

- [ ] Situational awareness: if it's a git repo, check the gitignore, and get a
  bunch of the directory heirarchy into context space automatically.
- [ ] Gemini API support: their "openai-compatible" API isn't complete enough
  to work with Octo
- [ ] Refactor History/IR for type safety: link back between i.e. tool calls,
  tool outputs, and original assistant messages
- [ ] Refactor menu system to use the new Router/Back stuff built for the add
  model flow.
- [ ] Refactor first-time setup to use the new Router/Back stuff built for the
  add model flow.
- [ ] Allow Anthropic models to configure the thinking budget by tokens, rather
  than low/medium/high corresponding to specific budgets (2048/4096/8192)
- [ ] Prompt on app start for an API key if no API key is set up for autofix
  models if they're turned on
- [ ] Make CustomAuthFlow (and CustomModelFlow) automatically handle overriding
  the default API key for a built-in provider, or make it simple for callers to
  do so. Currently they don't, and it's a pain to handle it at each callsite.
- [ ] Prompt for api key for the cli prompt subcommand
- [ ] Make the CLI prompt subcommand work with the anthropic and responses APIs
- [ ] Add clickable URLs for known inference hosts to get an API key — use
  wandb-style authorize URLs if they exist!
- [ ] Generate desktop notifs with configurable debounce when waiting for user
  input via https://github.com/Aetherinox/node-toasted-notifier
- [ ] Consider not keeping the current files up-to-date and instead only
  updating them on read tool call. Could be confusing to see a bunch of stuff
  change in the history without telling the LLM what's going on
- [ ] Add special rendering for certain classes of errors, e.g. auth failures
  or payment-related failures
