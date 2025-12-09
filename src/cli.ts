#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import { config } from 'dotenv';

// Load .env
const packageRoot = typeof __dirname !== 'undefined' ? __dirname : path.dirname(process.argv[1] || '');
config({ path: path.join(packageRoot, '..', '.env') });

import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import { z } from "zod";

// --- IMPORTS ---
import { ChatGroq } from "@langchain/groq"; 
import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";
import { StateGraph, END, Annotation, START } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SystemMessage, HumanMessage, BaseMessage, AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";

const clr = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

const CURRENT_WORKING_DIR = process.cwd(); 

// --- HELPER FUNCTIONS ---

// Helper for Recursive File Listing
async function getFileTree(dir: string, depth: number = 0, maxDepth: number = 2): Promise<string> {
  if (depth > maxDepth) return "";
  try {
    const files = await fs.readdir(dir);
    let output = "";
    
    for (const file of files) {
      // Ignore common clutter folders to keep the tree clean
      if (['node_modules', '.git', 'dist', '.next', '.DS_Store', 'coverage'].includes(file)) continue; 
      
      const fullPath = path.join(dir, file);
      const stat = await fs.stat(fullPath);
      const prefix = "  ".repeat(depth) + "|-- ";
      
      output += `${prefix}${file}\n`;
      
      if (stat.isDirectory()) {
        output += await getFileTree(fullPath, depth + 1, maxDepth);
      }
    }
    return output;
  } catch (e) {
    return ""; // Skip folders we can't read
  }
}

// --- TOOLS ---

// 1. Web Search
const searchTool = tool(
  async ({ query }) => {
    try {
      const safeQuery = query.slice(0, 200); 
      const retriever = new TavilySearchAPIRetriever({ k: 3, apiKey: process.env.TAVILY_API_KEY });
      const docs = await retriever.invoke(safeQuery);
      return docs.map(doc => `${doc.pageContent}\nSource: ${doc.metadata.source || 'N/A'}`).join('\n\n---\n\n');
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { 
    name: "tavily_search", 
    description: "Search the web for documentation, library versions, or error solutions.", 
    schema: z.object({ query: z.string() }) 
  }
);

// 2. Smart Recursive List Files
const listFilesTool = tool(
  async ({ dirPath, depth }) => {
    try {
      const target = path.resolve(CURRENT_WORKING_DIR, dirPath || ".");
      return await getFileTree(target, 0, depth || 2);
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { 
    name: "list_files", 
    description: "View the project file structure as a tree. Use 'depth' (default 2) to see subfolders.", 
    schema: z.object({ dirPath: z.string().optional(), depth: z.number().optional() }) 
  }
);

// 3. Smart Read File (Line Numbers & Ranges)
const readFileTool = tool(
  async ({ filePath, startLine, endLine }) => {
    try {
      const target = path.resolve(CURRENT_WORKING_DIR, filePath);
      
      // Basic Security
      if (filePath.includes('.env') || filePath.includes('id_rsa')) {
        return "⚠️ Error: Access to sensitive files (keys/secrets) is restricted for security.";
      }

      const content = await fs.readFile(target, 'utf-8');
      const lines = content.split('\n');
      
      const start = startLine ? startLine - 1 : 0;
      const end = endLine ? endLine : lines.length;
      
      // Limit to 300 lines per read to prevent context overflow
      if (end - start > 300) {
        return `⚠️ Error: The file is too large to read at once. Please read chunks of 300 lines or less. (Example: startLine: ${start + 1}, endLine: ${start + 300})`;
      }

      // Add line numbers to the output
      const selectedLines = lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`);
      return selectedLines.join('\n');
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { 
    name: "read_file", 
    description: "Read file content with line numbers. Use startLine/endLine to read large files in chunks.", 
    schema: z.object({ 
      filePath: z.string(),
      startLine: z.number().optional().describe("Start line number (1-based)"),
      endLine: z.number().optional().describe("End line number (inclusive)")
    }) 
  }
);

// --- GRAPH SETUP ---
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (x, y) => x.concat(y) }),
});

if (!process.env.GROQ_API_KEY) {
  console.error('❌ Error: GROQ_API_KEY is missing in .env');
  process.exit(1);
}

// Initializing Llama 3 for best tool-calling performance
const llm = new ChatGroq({
  model: "llama-3.3-70b-versatile", 
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
});

// --- NODE LOGIC ---

const agentNode = async (state: typeof AgentState.State) => {
  const tools = [listFilesTool, readFileTool, searchTool];
  const nodeLLM = llm.bindTools(tools);
  
  const systemMsg = new SystemMessage(`
    You are a Senior Developer Assistant.
    You have access to the files in: ${CURRENT_WORKING_DIR}

    GOAL: Answer the user's questions accurately by reading their code or searching the web.

    GUIDELINES:
    1. **Context First:** Always use 'list_files' to see the project structure before guessing file names.
    2. **Smart Reading:** - If a file seems large, read the first 100 lines (startLine: 1, endLine: 100).
       - If you need to see a specific function, read the lines around it.
       - Use the Line Numbers provided in the output to reference code in your answer (e.g., "The bug is on line 42").
    3. **Web Search:** Use 'tavily_search' for libraries, errors, or documentation.
    4. **Be Concise:** Don't dump code unless asked. Explain the solution.
  `);

  const response = await nodeLLM.invoke([systemMsg, ...state.messages]);
  return { messages: [response] };
};

// --- GRAPH CONSTRUCTION ---
const workflow = new StateGraph(AgentState)
  .addNode("Agent", agentNode)
  .addNode("tools", new ToolNode([listFilesTool, readFileTool, searchTool]))

  .addEdge(START, "Agent")
  
  // Logic: If the agent calls a tool, go to 'tools', otherwise END.
  .addConditionalEdges("Agent", (state) => {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg instanceof AIMessage && lastMsg.tool_calls?.length) {
      return "tools";
    }
    return END;
  })
  
  .addEdge("tools", "Agent"); // Loop back to Agent to interpret tool output

// Memory
const memory = SqliteSaver.fromConnString(path.resolve(__dirname, "../agent_memory.db"));

const app = workflow.compile({
  checkpointer: memory,
});

// --- INTERACTIVE LOOP ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  let userInput = process.argv[2] || "";
  const threadId = "dev-session-v2"; // Bumped version for new tools
  const config = { configurable: { thread_id: threadId } };

  if (!userInput) {
    console.log(`\n${clr.green}👨‍💻 Senior Dev Agent Active in: ${CURRENT_WORKING_DIR}${clr.reset}`);
    userInput = await question(`\n${clr.bright}Ask me about your project:${clr.reset} `);
  }

  while (true) {
    if (userInput.toLowerCase() === 'exit') break;

    const inputs = { messages: [new HumanMessage(userInput)] };
    let stream = await app.stream(inputs, config);

    for await (const event of stream) {
      const [nodeName, output] = Object.entries(event)[0];

      if (nodeName === 'Agent') {
        const messages = (output as any).messages;
        if (messages?.length) {
          const lastMsg = messages[messages.length - 1] as AIMessage;
          if (lastMsg.content) console.log(`\n${clr.cyan}🤖 Agent:${clr.reset} ${lastMsg.content}`);
          if (lastMsg.tool_calls?.length) console.log(`${clr.yellow}⚡ Action:${clr.reset} ${lastMsg.tool_calls[0].name}`);
        }
      }
      if (nodeName === 'tools') {
         console.log(`${clr.dim}🛠️  Tool Output Received${clr.reset}`);
      }
    }

    userInput = await question(`\n${clr.bright}Next:${clr.reset} `);
  }
  rl.close();
}

main();