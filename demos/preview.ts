import { readdir } from "fs/promises";
import { Argument, Command } from "@commander-js/extra-typings";

const files = await readdir(import.meta.dir);
const components = files
  .filter(file => file.endsWith(".demo.tsx"))
  .map(file => file.slice(0, -".demo.tsx".length))
  .sort();

await new Command()
  .name("bun run preview")
  .description("Run an interactive component demo.")
  .addArgument(new Argument("<component>", "Component to preview").choices(components))
  .showHelpAfterError()
  .action(async component => {
    await import(`./${component}.demo.tsx`);
  })
  .parseAsync(process.argv);
