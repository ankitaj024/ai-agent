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
const execAsync = promisify(exec);

// --- HELPER FUNCTIONS ---

// Helper for Recursive File Listing
async function getFileTree(dir: string, depth: number = 0, maxDepth: number = 2): Promise<string> {
  if (depth > maxDepth) return "";
  try {
    const files = await fs.readdir(dir);
    let output = "";
    
    for (const file of files) {
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
  } catch (e) { return ""; }
}

// Helper to print stream events (Standardizes output)
async function printStream(stream: any) {
    for await (const event of stream) {
      const [nodeName, output] = Object.entries(event)[0];

      if (nodeName === 'Agent') {
        const messages = (output as any).messages;
        if (messages?.length) {
          const lastMsg = messages[messages.length - 1] as AIMessage;
          if (lastMsg.content) console.log(`\n${clr.cyan}🤖 Agent:${clr.reset} ${lastMsg.content}`);
        }
      }
      if (nodeName === 'tools') {
         const messages = (output as any).messages;
         if (messages?.length) {
            const lastMsg = messages[messages.length - 1];
            // Print the actual output from the tool (e.g. command result)
            if (lastMsg.content) {
               console.log(`${clr.green}📜 Output:${clr.reset}\n${lastMsg.content}`);
            }
         }
      }
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
    description: "Search the web for docs, library versions, or error fixes.", 
    schema: z.object({ query: z.string() }) 
  }
);

// 2. Smart List Files
const listFilesTool = tool(
  async ({ dirPath, depth }) => {
    try {
      const target = path.resolve(CURRENT_WORKING_DIR, dirPath || ".");
      return await getFileTree(target, 0, depth || 2);
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { 
    name: "list_files", 
    description: "View project file structure. Use 'depth' (default 2) to see subfolders.", 
    schema: z.object({ dirPath: z.string().optional(), depth: z.number().optional() }) 
  }
);

// 3. Smart Read File
const readFileTool = tool(
  async ({ filePath, startLine, endLine }) => {
    try {
      const target = path.resolve(CURRENT_WORKING_DIR, filePath);
      if (filePath.includes('.env') || filePath.includes('id_rsa')) return "⚠️ Error: Restricted file.";

      const content = await fs.readFile(target, 'utf-8');
      const lines = content.split('\n');
      const start = startLine ? startLine - 1 : 0;
      const end = endLine ? endLine : lines.length;
      
      if (end - start > 300) return `⚠️ Error: File too large. Read lines ${start + 1}-${start + 300} instead.`;

      return lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { 
    name: "read_file", 
    description: "Read file content with line numbers.", 
    schema: z.object({ 
      filePath: z.string(),
      startLine: z.number().optional(),
      endLine: z.number().optional()
    }) 
  }
);

// 4. Write File (The Writer Module)
const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      const target = path.resolve(CURRENT_WORKING_DIR, filePath);
      await fs.writeFile(target, content);
      return `✅ Successfully wrote to ${filePath}`;
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  {
    name: "write_file",
    description: "Write content to a file. Overwrites existing files.",
    schema: z.object({ filePath: z.string(), content: z.string() })
  }
);

// 5. Terminal (The Execution Module)
const terminalTool = tool(
  async ({ command }) => {
    try {
      if (command.includes('rm -rf') || command.includes('sudo') || command.includes('format')) {
        return "❌ Error: Command blocked for safety.";
      }
      const { stdout, stderr } = await execAsync(command, { cwd: CURRENT_WORKING_DIR });
      return stdout || stderr || "✅ Command executed successfully (no output).";
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  {
    name: "terminal",
    description: "Execute safe terminal commands (npm, git, node, etc).",
    schema: z.object({ command: z.string() })
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

const llm = new ChatGroq({
  model: "llama-3.3-70b-versatile", 
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
});

// --- NODE LOGIC ---

const agentNode = async (state: typeof AgentState.State) => {
  const tools = [listFilesTool, readFileTool, searchTool, writeFileTool, terminalTool];
  const nodeLLM = llm.bindTools(tools);
  
  const systemMsg = new SystemMessage(`
    You are a Senior Developer Assistant.
    You have access to: ${CURRENT_WORKING_DIR}

    CAPABILITIES:
    1. **See:** Use 'list_files' and 'read_file' to explore code.
    2. **Research:** Use 'tavily_search' for docs/errors.
    3. **Act:** Use 'write_file' to fix code and 'terminal' to run commands.

    RULES:
    - **Context First:** Look before you leap. Read files before editing them.
    - **Safety:** You must be precise when writing code.
    - **Verification:** After writing code, try to run it (e.g., 'node file.js') if appropriate to verify it works.
  `);

  const response = await nodeLLM.invoke([systemMsg, ...state.messages]);
  return { messages: [response] };
};

// --- GRAPH CONSTRUCTION ---
const workflow = new StateGraph(AgentState)
  .addNode("Agent", agentNode)
  .addNode("tools", new ToolNode([listFilesTool, readFileTool, searchTool, writeFileTool, terminalTool]))

  .addEdge(START, "Agent")
  
  .addConditionalEdges("Agent", (state) => {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg instanceof AIMessage && lastMsg.tool_calls?.length) {
      return "tools";
    }
    return END;
  })
  
  .addEdge("tools", "Agent");

const memory = SqliteSaver.fromConnString(path.resolve(__dirname, "../agent_memory.db"));

const app = workflow.compile({
  checkpointer: memory,
  interruptBefore: ["tools"], // PAUSE BEFORE ACTIONS
});

// --- INTERACTIVE LOOP ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q: string) => new Promise<string>((r) => rl.question(q, r));

async function main() {
  let userInput = process.argv[2] || "";
  const threadId = "dev-session-v5"; 
  const config = { configurable: { thread_id: threadId } };

  if (!userInput) {
    console.log(`\n${clr.green}👨‍💻 Senior Dev Agent Active in: ${CURRENT_WORKING_DIR}${clr.reset}`);
    userInput = await question(`\n${clr.bright}Instruct:${clr.reset} `);
  }

  while (true) {
    if (userInput.toLowerCase() === 'exit') break;

    const inputs = { messages: [new HumanMessage(userInput)] };
    
    // 1. Start the first turn
    let stream = await app.stream(inputs, config);
    await printStream(stream);

    // 2. Chaining Loop: Keep checking if the agent wants to do more (Write -> Run -> etc)
    while (true) {
      const snapshot = await app.getState(config);
      
      // If agent is done or not paused at tools, break the chaining loop
      if (snapshot.next.length === 0 || !snapshot.next.includes("tools")) {
         break;
      }

      // Agent is paused and wants to run a tool
      const lastMsg = snapshot.values.messages[snapshot.values.messages.length - 1] as AIMessage;
      const toolCall = lastMsg.tool_calls?.[0];

      // Ask for permission
      if (toolCall) {
        console.log(`${clr.yellow}⚡ Agent wants to: ${clr.bright}${toolCall.name}${clr.reset}`);
        console.log(`${clr.dim}   Args: ${JSON.stringify(toolCall.args)}${clr.reset}`);
        
        const answer = await question(`\n${clr.red}⚠️  PERMISSION REQUIRED:${clr.reset} Allow? (y/n) `);
        
        if (answer.toLowerCase() === 'y') {
           // RESUME EXECUTION
           const nextStream = await app.stream(null, config);
           await printStream(nextStream);
           // Loop continues to check if there is a next step...
        } else {
           console.log("❌ Denied.");
           break;
        }
      }
    }

    // Only ask for new input when the Agent is completely done with the chain
    userInput = await question(`\n${clr.bright}Next:${clr.reset} `);
  }
  rl.close();
}

main();