TODO:

- [ ] Situational awareness: if it's a git repo, check the gitignore, and get a
  bunch of the directory heirarchy into context space automatically.
- [ ] Gemini API support: their "openai-compatible" API isn't complete enough
  to work with Octo
- [ ] Refactor History/IR for type safety: link back between i.e. tool calls,
  tool outputs, and original assistant messages. Make rejections linked to the
  actual user message rejecting the call
- [ ] Remove all instances of `throw` and replace with Result types.
- [ ] Refactor menu system to use the new Router/Back stuff built for the add
  model flow.
- [ ] Refactor first-time setup to use the new Router/Back stuff built for the
  add model flow.
- [ ] Allow Anthropic models to configure the thinking budget by tokens, rather
  than low/medium/high corresponding to specific budgets (2048/4096/8192)
- [ ] Handle missing auth when switching models
- [ ] Make the CLI prompt subcommand work with the anthropic and responses APIs
- [ ] Make the CLI prompt subcommand handle reasoning tokens by streaming them
  to stderr, whereas the content tokens go to stdout
- [ ] Add clickable URLs for known inference hosts to get an API key — use
  wandb-style authorize URLs if they exist!
- [ ] Generate desktop notifs with configurable debounce when waiting for user
  input via https://github.com/Aetherinox/node-toasted-notifier
- [ ] Consider not keeping the current files up-to-date and instead only
  updating them on read tool call. Could be confusing to see a bunch of stuff
  change in the history without telling the LLM what's going on
- [ ] Add special rendering for certain classes of errors, e.g. auth failures
  or payment-related failures
  - [x] Synthetic payment errors
  - [ ] Anthropic payment errors
  - [ ] OpenAI payment errors
  - [ ] Synthetic auth failures
  - [ ] Anthropic auth failures
  - [ ] OpenAI auth failures
- [ ] Run the test-connection code for autofix models and all supported auth
  providers, and show billing- or auth-related errors immediately
- [ ] Port Aider Polyglot benchmarks to Octo, run inside a container
- [ ] Add SSH transport
- [ ] When Octo returns input back to the user, run a special loop with a basic
  prompt that checks whether Octo forgot anything (i.e. did it run tests, run a
  compiler, etc).
- [ ] Fix crash when model tries to load a non-existent file
- [ ] If the terminal window is small, show diffs stacked on top of each other
  instead of side-by-side
