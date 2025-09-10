import { Token, Tokens } from "marked";

export function isLinkToken(token: Token): token is Tokens.Link {
  return token.type === "link";
}

export function isImageToken(token: Token): token is Tokens.Image {
  return token.type === "image";
}

export function isTextToken(token: Token): token is Tokens.Text {
  return token.type === "text";
}

export function isStrongToken(token: Token): token is Tokens.Strong {
  return token.type === "strong";
}

export function isEmToken(token: Token): token is Tokens.Em {
  return token.type === "em";
}

export function isDelToken(token: Token): token is Tokens.Del {
  return token.type === "del";
}

export function isCodespanToken(token: Token): token is Tokens.Codespan {
  return token.type === "codespan";
}