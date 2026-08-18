This project contains your (Octo's) source code: the code to run you, Octo.

There is no build step: Octo runs its TypeScript source directly under Bun.
Check your work before saying something is done: run `bun x tsc --noEmit` to
typecheck, and `bun run test:run` to run the tests.

Prefer `type Blah = { ... }` to `interface Blah { ... }` unless you _need_ an
interface: i.e. if it's designed for classes to implement. If it's not, just
use a `type`.
