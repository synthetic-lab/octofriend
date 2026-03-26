export type LspInstallationConfig = {
  serverName: string;
  command: string[];
  extensions: string[];
  rootCandidates: string[];
  description?: string;
  installCmd?: string[];
  // TODO (LSP): test & implement initializationOptions to enable PyRight TerraformLS (not added yet)
  // initializationOptions?(root: string): Promise<Record<string, any> | undefined>;
};

export const Typescript: LspInstallationConfig = {
  serverName: "typescript-language-server",
  command: ["typescript-language-server", "--stdio"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  rootCandidates: ["package.json", "tsconfig.json", "jsconfig.json"],
  description: "TypeScript/JavaScript language server",
  installCmd: ["npm", "install", "-g", "typescript-language-server", "typescript"],
};

export const Gopls: LspInstallationConfig = {
  serverName: "gopls",
  command: ["gopls"],
  extensions: [".go"],
  rootCandidates: ["go.work", "go.mod", "go.sum"],
  description: "Go language server",
  installCmd: ["go", "install", "golang.org/x/tools/gopls@latest"],
};

export const RustAnalyzer: LspInstallationConfig = {
  serverName: "rust-analyzer",
  command: ["rust-analyzer"],
  extensions: [".rs"],
  rootCandidates: ["Cargo.toml", "Cargo.lock"],
  description: "Rust language server",
  installCmd: ["rustup", "component", "add", "rust-analyzer"],
};

export const BashLS: LspInstallationConfig = {
  serverName: "bash-language-server",
  command: ["bash-language-server", "start"],
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  rootCandidates: [],
  description: "Bash/Shell language server",
  installCmd: ["npm", "install", "-g", "bash-language-server"],
};

export const LuaLS: LspInstallationConfig = {
  serverName: "lua-ls",
  command: ["lua-language-server"],
  extensions: [".lua"],
  rootCandidates: [".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml"],
  description: "Lua language server",
  installCmd: ["brew", "install", "lua-language-server"],
};

export const Rubocop: LspInstallationConfig = {
  serverName: "ruby-lsp",
  command: ["ruby-lsp"],
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  rootCandidates: ["Gemfile", "Rakefile", ".ruby-version"],
  description: "Ruby language server",
  installCmd: ["gem", "install", "ruby-lsp"],
};

export const JDTLS: LspInstallationConfig = {
  serverName: "jdtls",
  command: ["jdtls"],
  extensions: [".java"],
  rootCandidates: [
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    ".classpath",
    "settings.gradle",
    "settings.gradle.kts",
  ],
  description: "Java language server (Eclipse JDT)",
  installCmd: ["brew", "install", "jdtls"],
};

export const HLS: LspInstallationConfig = {
  serverName: "hls",
  command: ["haskell-language-server-wrapper", "--lsp"],
  extensions: [".hs", ".lhs"],
  rootCandidates: ["stack.yaml", "cabal.project", "hie.yaml"],
  description: "Haskell language server",
  installCmd: ["ghcup", "install", "hls"],
};

export const Gleam: LspInstallationConfig = {
  serverName: "Gleam language server",
  command: ["gleam", "lsp"],
  extensions: [".gleam"],
  rootCandidates: ["gleam.toml"],
  description: "Gleam language server (bundled with the Gleam compiler)",
  installCmd: ["brew", "install", "gleam"],
};

export const Ocaml: LspInstallationConfig = {
  serverName: "ocaml-lsp",
  command: ["ocamllsp"],
  extensions: [".ml", ".mli"],
  rootCandidates: ["dune-project", "dune-workspace", ".merlin", ".ocamlformat"],
  description: "OCaml language server",
  installCmd: ["opam", "install", "ocaml-lsp-server"],
};

export const Nixd: LspInstallationConfig = {
  serverName: "nixd",
  command: ["nixd"],
  extensions: [".nix"],
  rootCandidates: ["flake.nix", "default.nix", "shell.nix"],
  description: "Nix language server",
  installCmd: ["nix", "profile", "install", "nixpkgs#nixd"],
};

export const Clojure: LspInstallationConfig = {
  serverName: "clojure-lsp",
  command: ["clojure-lsp", "listen"],
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  rootCandidates: ["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"],
  description: "Clojure language server",
  installCmd: ["brew", "install", "clojure-lsp/brew/clojure-lsp-native"],
};

export const YamlLS: LspInstallationConfig = {
  serverName: "yaml-ls",
  command: ["yaml-language-server", "--stdio"],
  extensions: [".yaml", ".yml"],
  rootCandidates: ["package.json"],
  description: "YAML language server",
  installCmd: ["npm", "install", "-g", "yaml-language-server"],
};

export const Svelte: LspInstallationConfig = {
  serverName: "svelteserver",
  command: ["svelteserver", "--stdio"],
  extensions: [".svelte"],
  rootCandidates: ["svelte.config.js", "svelte.config.ts", "package.json"],
  description: "Svelte language server",
  installCmd: ["npm", "install", "-g", "svelte-language-server"],
};

export const Vue: LspInstallationConfig = {
  serverName: "vue-language-server",
  command: ["vue-language-server", "--stdio"],
  extensions: [".vue"],
  rootCandidates: ["vue.config.js", "nuxt.config.ts", "nuxt.config.js", "package.json"],
  description: "Vue language server",
  installCmd: ["npm", "install", "-g", "@vue/language-server"],
};

export const Astro: LspInstallationConfig = {
  serverName: "astro",
  command: ["astro-ls", "--stdio"],
  extensions: [".astro"],
  rootCandidates: ["astro.config.mjs", "astro.config.ts", "package.json"],
  description: "Astro language server",
  installCmd: ["npm", "install", "-g", "@astrojs/language-server"],
};

export const Prisma: LspInstallationConfig = {
  serverName: "Prisma language server",
  command: ["prisma", "language-server"],
  extensions: [".prisma"],
  rootCandidates: ["schema.prisma", "prisma/schema.prisma"],
  description: "Prisma language server",
  installCmd: ["npm", "install", "-g", "@prisma/language-server"],
};

export const PHPIntelephense: LspInstallationConfig = {
  serverName: "intelephense",
  command: ["intelephense", "--stdio"],
  extensions: [".php"],
  rootCandidates: ["composer.json", "composer.lock", ".php-version"],
  description: "PHP language server",
  installCmd: ["npm", "install", "-g", "intelephense"],
};

export const JuliaLS: LspInstallationConfig = {
  serverName: "julials",
  command: [
    "julia",
    "--startup-file=no",
    "--history-file=no",
    "-e",
    "using LanguageServer; runserver()",
  ],
  extensions: [".jl"],
  rootCandidates: ["Project.toml", "Manifest.toml"],
  description: "Julia language server",
  installCmd: ["julia", "-e", 'using Pkg; Pkg.add("LanguageServer")'],
};

export const Tinymist: LspInstallationConfig = {
  serverName: "tinymist",
  command: ["tinymist", "lsp"],
  extensions: [".typ", ".typc"],
  rootCandidates: ["typst.toml"],
  description: "Typst language server",
  installCmd: ["cargo", "install", "tinymist"],
};

// TODO (LSP): add:
// - Clangd, KotlinLS, SourceKit, Dart, ElixirLS, Zls
//   - require more complex installation instructions than a simple command
// - Pyright, TerraformLS
//   - need an initialization function to set the workspace to the project root (instead of cwd)
export const RecommendedLspServers: LspInstallationConfig[] = [
  Typescript,
  Gopls,
  RustAnalyzer,
  BashLS,
  LuaLS,
  Rubocop,
  JDTLS,
  HLS,
  Gleam,
  Ocaml,
  Nixd,
  Clojure,
  YamlLS,
  Svelte,
  Vue,
  Astro,
  Prisma,
  PHPIntelephense,
  JuliaLS,
  Tinymist,
];
