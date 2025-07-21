This project contains your (Octo's) source code: the code to build you, Octo.

This project can take up to 20s to build via `npx tsc`. Make sure your timeouts
are long enough.

Prefer `type Blah = { ... }` to `interface Blah { ... }` unless you *need* an
interface: i.e. if it's designed for classes to implement. If it's not, just
use a `type`.
