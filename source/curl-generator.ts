import {
  AnthropicRequestDetails,
  RequestDetails,
  ResponsesRequestDetails,
  StandardRequestDetails,
} from "./ir/llm-ir.ts";

export function generateCurlForRequest(request: RequestDetails): string {
  switch (request.type) {
    case "standard":
      return generateStandardCurl(request);
    case "responses":
      return generateResponsesCurl(request);
    case "anthropic":
      return generateAnthropicCurl(request);
  }
}

function generateStandardCurl(request: StandardRequestDetails): string {
  return `curl -X POST '${request.baseUrl}/chat/completions' \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer [REDACTED_API_KEY]" \\
  -d @- <<'JSON'
${JSON.stringify(request.body)}
JSON`;
}

function generateResponsesCurl(request: ResponsesRequestDetails): string {
  return `curl -X POST '${request.baseUrl}/responses' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer [REDACTED_API_KEY]' \\
  -d @- <<'JSON'
${JSON.stringify(request.body)}
JSON`;
}

function generateAnthropicCurl(request: AnthropicRequestDetails): string {
  const ANTHROPIC_API_VERSION = "2023-06-01";

  return `curl -X POST "${request.baseUrl}/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: [REDACTED_API_KEY]" \\
  -H "anthropic-version: ${ANTHROPIC_API_VERSION}" \\
  -d @- <<'JSON'
${JSON.stringify(request.body)}
JSON`;
}
