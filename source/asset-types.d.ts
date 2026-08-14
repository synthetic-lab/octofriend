declare module "*.md" {
  const content: string;
  export default content;
}

declare module "*.sql" {
  const content: string;
  export default content;
}

// Native addons are embedded as file assets; importing one yields its
// embedded path, not a module.
declare module "*.node" {
  const embeddedPath: string;
  export default embeddedPath;
}
