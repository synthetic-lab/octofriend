#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({
  name: "archon-intelligence-test",
  version: "1.0.0",
});

const transport = new StdioClientTransport({
  command: "/home/zebastjan/dev/archon/python/archon-mcp-stdio",
  args: [],
  env: process.env,
  stderr: "inherit",
});

async function testArchonIntelligence() {
  try {
    console.log("🔌 Connecting to Archon MCP...\n");
    await client.connect(transport);
    console.log("✅ Connected!\n");

    // Test 1: Check available knowledge sources
    console.log("📚 Test 1: Checking available knowledge sources...");
    console.log("═".repeat(80));
    const sources = await client.callTool({
      name: "rag_get_available_sources",
      arguments: {}
    });
    console.log(formatResult(sources));

    // Test 2: List projects
    console.log("\n📁 Test 2: Listing projects...");
    console.log("═".repeat(80));
    const projects = await client.callTool({
      name: "find_projects",
      arguments: { action: "list" }
    });
    console.log(formatResult(projects));

    // Test 3: List tasks
    console.log("\n✅ Test 3: Listing tasks...");
    console.log("═".repeat(80));
    const tasks = await client.callTool({
      name: "find_tasks",
      arguments: { action: "list" }
    });
    console.log(formatResult(tasks));

    // Test 4: Get worktree info
    console.log("\n🌳 Test 4: Getting current worktree info...");
    console.log("═".repeat(80));
    const worktree = await client.callTool({
      name: "worktree_get_current_info",
      arguments: {}
    });
    console.log(formatResult(worktree));

    // Test 5: Try a RAG search for "MCP server"
    console.log("\n🔍 Test 5: RAG search for 'MCP server configuration'...");
    console.log("═".repeat(80));
    const ragSearch = await client.callTool({
      name: "rag_search_knowledge_base",
      arguments: { query: "MCP server configuration" }
    });
    console.log(formatResult(ragSearch));

    // Test 6: Search for code examples
    console.log("\n💻 Test 6: Searching for code examples related to 'error handling'...");
    console.log("═".repeat(80));
    const codeSearch = await client.callTool({
      name: "rag_search_code_examples",
      arguments: { query: "error handling" }
    });
    console.log(formatResult(codeSearch));

    console.log("\n" + "═".repeat(80));
    console.log("🎉 All tests completed!");

    await client.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

function formatResult(result) {
  if (!result || !result.content) return "No content returned";

  return result.content
    .map(item => {
      if (item.type === "text") {
        // Try to parse as JSON for pretty printing
        try {
          const parsed = JSON.parse(item.text);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return item.text;
        }
      }
      return `[${item.type}]`;
    })
    .join("\n");
}

testArchonIntelligence();
