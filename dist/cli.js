#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
const child_process_1 = require("child_process");
const util_1 = require("util");
const readline = __importStar(require("readline"));
const zod_1 = require("zod");
// --- EXTERNAL LIBS ---
const diff = __importStar(require("diff"));
// --- AUDIO IMPORTS ---
// @ts-ignore
const recorder = __importStar(require("node-record-lpcm16"));
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const groq_1 = require("@langchain/groq");
// --- LANGCHAIN IMPORTS ---
const tavily_search_api_1 = require("@langchain/community/retrievers/tavily_search_api");
const langgraph_1 = require("@langchain/langgraph");
const langgraph_checkpoint_sqlite_1 = require("@langchain/langgraph-checkpoint-sqlite");
const prebuilt_1 = require("@langchain/langgraph/prebuilt");
const messages_1 = require("@langchain/core/messages");
const tools_1 = require("@langchain/core/tools");
// Load .env
const packageRoot = typeof __dirname !== 'undefined' ? __dirname : path.dirname(process.argv[1] || '');
(0, dotenv_1.config)({ path: path.join(packageRoot, '..', '.env') });
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
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const groq = new groq_sdk_1.default({ apiKey: process.env.GROQ_API_KEY });
// --- HELPER FUNCTIONS ---
async function getFileTree(dir, depth = 0, maxDepth = 2) {
    if (depth > maxDepth)
        return "";
    try {
        const files = await fsp.readdir(dir);
        let output = "";
        for (const file of files) {
            if (['node_modules', '.git', 'dist', '.next', '.DS_Store', 'coverage'].includes(file))
                continue;
            const fullPath = path.join(dir, file);
            const stat = await fsp.stat(fullPath);
            const prefix = "  ".repeat(depth) + "|-- ";
            output += `${prefix}${file}\n`;
            if (stat.isDirectory()) {
                output += await getFileTree(fullPath, depth + 1, maxDepth);
            }
        }
        return output;
    }
    catch (e) {
        return "";
    }
}
// --- PROJECT CONTEXT LOADER (FIXED TYPE) ---
async function loadProjectContext() {
    const context = [];
    // FIX: Explicitly type this as string[] so TS doesn't think it's 'never[]'
    const files = await fsp.readdir(CURRENT_WORKING_DIR).catch(() => []);
    if (files.includes('package.json')) {
        try {
            const content = await fsp.readFile(path.join(CURRENT_WORKING_DIR, 'package.json'), 'utf-8');
            const pkg = JSON.parse(content);
            context.push(`[Node.js Project Detected]`);
            if (pkg.name)
                context.push(`- Name: ${pkg.name}`);
            if (pkg.scripts)
                context.push(`- Scripts: ${Object.keys(pkg.scripts).join(', ')}`);
            if (pkg.dependencies)
                context.push(`- Main Deps: ${Object.keys(pkg.dependencies).slice(0, 10).join(', ')}`);
        }
        catch { /* ignore bad json */ }
    }
    if (files.includes('requirements.txt')) {
        context.push(`[Python Project Detected]`);
        const content = await fsp.readFile(path.join(CURRENT_WORKING_DIR, 'requirements.txt'), 'utf-8');
        context.push(`- Requirements: ${content.split('\n').slice(0, 5).join(', ')}...`);
    }
    if (files.includes('Dockerfile') || files.includes('docker-compose.yml')) {
        context.push(`[Docker Detected]`);
    }
    if (files.includes('README.md')) {
        const content = await fsp.readFile(path.join(CURRENT_WORKING_DIR, 'README.md'), 'utf-8');
        context.push(`[README Summary]: ${content.slice(0, 300).replace(/\n/g, ' ')}...`);
    }
    return context.length > 0 ? context.join('\n') : "No specific project configuration found.";
}
async function printStream(stream) {
    for await (const event of stream) {
        const [nodeName, output] = Object.entries(event)[0];
        if (nodeName === 'Agent') {
            const messages = output.messages;
            if (messages?.length) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.content)
                    console.log(`\n${clr.cyan}🤖 Agent:${clr.reset} ${lastMsg.content}`);
            }
        }
        if (nodeName === 'tools') {
            const messages = output.messages;
            if (messages?.length) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg.content) {
                    console.log(`${clr.green}📜 Output:${clr.reset}\n${lastMsg.content}`);
                }
            }
        }
    }
}
function askQuestion(query, prefill = "") {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
        if (prefill) {
            rl.write(prefill);
        }
    });
}
function showDiff(filePath, newContent) {
    const target = path.resolve(CURRENT_WORKING_DIR, filePath);
    if (!fs.existsSync(target)) {
        console.log(clr.green + `\n+++ Creating NEW file: ${filePath}` + clr.reset);
        const lines = newContent.split('\n');
        console.log(lines.slice(0, 10).join('\n') + (lines.length > 10 ? `\n... (${lines.length - 10} more lines)` : ''));
        return;
    }
    const oldContent = fs.readFileSync(target, 'utf-8');
    const changes = diff.diffLines(oldContent, newContent);
    let hasChanges = false;
    console.log(clr.yellow + `\n📝 Proposed Changes for: ${filePath}` + clr.reset);
    console.log(clr.dim + '--------------------------------------' + clr.reset);
    changes.forEach(part => {
        if (part.added || part.removed) {
            hasChanges = true;
            const color = part.added ? clr.green : clr.red;
            const prefix = part.added ? '+ ' : '- ';
            process.stdout.write(color + part.value.replace(/^/gm, prefix) + clr.reset);
        }
    });
    if (!hasChanges) {
        console.log(clr.dim + "No actual changes detected." + clr.reset);
    }
    console.log(clr.dim + '--------------------------------------\n' + clr.reset);
}
// --- VOICE CAPTURE ---
async function captureVoice() {
    return new Promise((resolve, reject) => {
        const filePath = path.join(CURRENT_WORKING_DIR, 'temp_voice_input.wav');
        const fileStream = fs.createWriteStream(filePath, { encoding: 'binary' });
        console.log(`\n${clr.red}🎙️  Recording... Press CTRL+C to stop.${clr.reset}`);
        const recording = recorder.record({
            sampleRate: 16000,
            threshold: 0,
            verbose: false,
            recordProgram: 'rec',
            silence: '10.0',
        });
        recording.stream().pipe(fileStream);
        const cleanup = () => {
            process.stdin.removeListener('keypress', handleKey);
            if (process.stdin.isTTY)
                process.stdin.setRawMode(false);
            recording.stop();
        };
        const handleKey = (str, key) => {
            if (key && key.ctrl && key.name === 'c') {
                cleanup();
                console.log(`${clr.yellow}⏳ Transcribing...${clr.reset}`);
                setTimeout(async () => {
                    try {
                        const transcription = await groq.audio.transcriptions.create({
                            file: fs.createReadStream(filePath),
                            model: "whisper-large-v3",
                            response_format: "text"
                        });
                        if (fs.existsSync(filePath))
                            fs.unlinkSync(filePath);
                        const text = transcription.toString().trim();
                        resolve(text);
                    }
                    catch (error) {
                        if (fs.existsSync(filePath))
                            fs.unlinkSync(filePath);
                        reject(error);
                    }
                }, 1000);
            }
        };
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('keypress', handleKey);
        }
    });
}
// --- TOOLS ---
const searchTool = (0, tools_1.tool)(async ({ query }) => {
    try {
        const safeQuery = query.slice(0, 200);
        const retriever = new tavily_search_api_1.TavilySearchAPIRetriever({ k: 3, apiKey: process.env.TAVILY_API_KEY });
        const docs = await retriever.invoke(safeQuery);
        return docs.map(doc => `${doc.pageContent}\nSource: ${doc.metadata.source || 'N/A'}`).join('\n\n---\n\n');
    }
    catch (e) {
        return `Error: ${e.message}`;
    }
}, {
    name: "tavily_search",
    description: "Search the web for docs, library versions, or error fixes.",
    schema: zod_1.z.object({ query: zod_1.z.string() })
});
const listFilesTool = (0, tools_1.tool)(async ({ dirPath, depth }) => {
    try {
        const target = path.resolve(CURRENT_WORKING_DIR, dirPath || ".");
        return await getFileTree(target, 0, depth || 2);
    }
    catch (e) {
        return `Error: ${e.message}`;
    }
}, {
    name: "list_files",
    description: "View project file structure. Use 'depth' (default 2) to see subfolders.",
    schema: zod_1.z.object({ dirPath: zod_1.z.string().optional(), depth: zod_1.z.number().optional() })
});
const readFileTool = (0, tools_1.tool)(async ({ filePath, startLine, endLine }) => {
    try {
        const target = path.resolve(CURRENT_WORKING_DIR, filePath);
        if (filePath.includes('.env') || filePath.includes('id_rsa'))
            return "⚠️ Error: Restricted file.";
        const content = await fsp.readFile(target, 'utf-8');
        const lines = content.split('\n');
        const start = startLine ? startLine - 1 : 0;
        const end = endLine ? endLine : lines.length;
        if (end - start > 300)
            return `⚠️ Error: File too large. Read lines ${start + 1}-${start + 300} instead.`;
        return lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    }
    catch (e) {
        return `Error: ${e.message}`;
    }
}, {
    name: "read_file",
    description: "Read file content with line numbers.",
    schema: zod_1.z.object({
        filePath: zod_1.z.string(),
        startLine: zod_1.z.number().optional(),
        endLine: zod_1.z.number().optional()
    })
});
const writeFileTool = (0, tools_1.tool)(async ({ filePath, content }) => {
    try {
        const target = path.resolve(CURRENT_WORKING_DIR, filePath);
        await fsp.writeFile(target, content);
        return `✅ Successfully wrote to ${filePath}`;
    }
    catch (e) {
        return `Error: ${e.message}`;
    }
}, {
    name: "write_file",
    description: "Write content to a file. Overwrites existing files.",
    schema: zod_1.z.object({ filePath: zod_1.z.string(), content: zod_1.z.string() })
});
// --- UPDATED TERMINAL TOOL (SELF-HEALING) ---
const terminalTool = (0, tools_1.tool)(async ({ command }) => {
    try {
        if (command.includes('rm -rf') || command.includes('sudo') || command.includes('format')) {
            return "❌ Error: Command blocked for safety.";
        }
        const { stdout, stderr } = await execAsync(command, { cwd: CURRENT_WORKING_DIR });
        return stdout || stderr || "✅ Command executed successfully.";
    }
    catch (e) {
        // Return error to Agent so it can fix it
        return `❌ Command Failed:\n${e.message}\n\nSTDERR:\n${e.stderr || 'No stderr'}`;
    }
}, {
    name: "terminal",
    description: "Execute safe terminal commands (npm, git, node, etc).",
    schema: zod_1.z.object({ command: zod_1.z.string() })
});
// --- GRAPH SETUP ---
const AgentState = langgraph_1.Annotation.Root({
    messages: (0, langgraph_1.Annotation)({ reducer: (x, y) => x.concat(y) }),
});
if (!process.env.GROQ_API_KEY) {
    console.error('❌ Error: GROQ_API_KEY is missing in .env');
    process.exit(1);
}
const llm = new groq_1.ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    apiKey: process.env.GROQ_API_KEY,
});
const agentNode = async (state) => {
    const tools = [listFilesTool, readFileTool, searchTool, writeFileTool, terminalTool];
    const nodeLLM = llm.bindTools(tools);
    const projectContext = await loadProjectContext();
    const systemMsg = new messages_1.SystemMessage(`
    You are a Senior Developer Assistant.
    
    You have access to: ${CURRENT_WORKING_DIR}

    🚀 PROJECT CONTEXT:
    ${projectContext}

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
const workflow = new langgraph_1.StateGraph(AgentState)
    .addNode("Agent", agentNode)
    .addNode("tools", new prebuilt_1.ToolNode([listFilesTool, readFileTool, searchTool, writeFileTool, terminalTool]))
    .addEdge(langgraph_1.START, "Agent")
    .addConditionalEdges("Agent", (state) => {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg instanceof messages_1.AIMessage && lastMsg.tool_calls?.length) {
        return "tools";
    }
    return langgraph_1.END;
})
    .addEdge("tools", "Agent");
const memory = langgraph_checkpoint_sqlite_1.SqliteSaver.fromConnString(path.resolve(__dirname, "../agent_memory.db"));
const app = workflow.compile({
    checkpointer: memory,
    interruptBefore: ["tools"],
});
// --- MAIN LOOP ---
async function main() {
    let userInput = process.argv[2] || "";
    const threadId = "dev-session-v5";
    const config = { configurable: { thread_id: threadId } };
    console.log(`\n${clr.green}👨‍💻 Senior Dev Agent Active in: ${CURRENT_WORKING_DIR}${clr.reset}`);
    if (!userInput) {
        userInput = await askQuestion(`\n${clr.bright}Instruct (or 'v' for voice):${clr.reset} `);
    }
    while (true) {
        if (userInput.toLowerCase() === 'exit')
            break;
        if (userInput.toLowerCase() === 'v') {
            try {
                const transcribedText = await captureVoice();
                if (!transcribedText) {
                    userInput = await askQuestion(`\n${clr.bright}Instruct (or 'v' for voice):${clr.reset} `);
                    continue;
                }
                console.log(`${clr.green}🗣️  Recognized:${clr.reset} "${transcribedText}"`);
                userInput = await askQuestion(`${clr.bright}Edit/Confirm:${clr.reset} `, transcribedText);
            }
            catch (e) {
                console.log("Voice Error:", e.message || e);
                userInput = await askQuestion(`\n${clr.bright}Instruct (or 'v' for voice):${clr.reset} `);
                continue;
            }
        }
        const inputs = { messages: [new messages_1.HumanMessage(userInput)] };
        let stream = await app.stream(inputs, config);
        await printStream(stream);
        while (true) {
            const snapshot = await app.getState(config);
            if (snapshot.next.length === 0 || !snapshot.next.includes("tools")) {
                break;
            }
            const lastMsg = snapshot.values.messages[snapshot.values.messages.length - 1];
            const toolCall = lastMsg.tool_calls?.[0];
            if (toolCall) {
                console.log(`${clr.yellow}⚡ Agent wants to: ${clr.bright}${toolCall.name}${clr.reset}`);
                if (toolCall.name === 'write_file') {
                    const args = toolCall.args;
                    showDiff(args.filePath, args.content);
                }
                else {
                    console.log(`${clr.dim}   Args: ${JSON.stringify(toolCall.args)}${clr.reset}`);
                }
                const answer = await askQuestion(`\n${clr.red}⚠️  PERMISSION REQUIRED:${clr.reset} Allow? (y/n) `);
                if (answer.toLowerCase() === 'y') {
                    const nextStream = await app.stream(null, config);
                    await printStream(nextStream);
                }
                else {
                    console.log("❌ Denied.");
                    break;
                }
            }
        }
        userInput = await askQuestion(`\n${clr.bright}Next (or 'v'):${clr.reset} `);
    }
}
main();
