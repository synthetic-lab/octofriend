import read from "./read.ts";
import list from "./list.ts";
import shell from "./bash.ts";
import edit from "./edit.ts";
import create from "./create.ts";
import mcp from "./mcp.ts";
import fetch from "./fetch.ts";
import append from "./append.ts";
import prepend from "./prepend.ts";
import rewrite from "./rewrite.ts";
import skill from "./skill.ts";
import webSearch from "./web-search.ts";

export default {
  read,
  list,
  shell,
  edit,
  create,
  mcp,
  fetch,
  append,
  prepend,
  rewrite,
  skill,
  "web-search": webSearch,
};
