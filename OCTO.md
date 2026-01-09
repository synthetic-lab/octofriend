This project contains your (Octo's) source code: the code to build you, Octo.

This project can take up to 20s to build via `npm run build`. Make sure your
timeouts are long enough. Check your work before saying something is done: run
`npm run build` to make sure it builds cleanly and typechecks.

Prefer `type Blah = { ... }` to `interface Blah { ... }` unless you *need* an
interface: i.e. if it's designed for classes to implement. If it's not, just
use a `type`.
