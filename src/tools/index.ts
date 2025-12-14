import * as fsp from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { TavilySearchAPIRetriever } from "@langchain/community/retrievers/tavily_search_api";
import { ENV } from '../config/env';

const execAsync = promisify(exec);
const CURRENT_WORKING_DIR = process.cwd();

// --- 1. SEARCH TOOL ---
export const searchTool = tool(
  async ({ query }) => {
    try {
      const retriever = new TavilySearchAPIRetriever({ k: 3, apiKey: ENV.TAVILY_API_KEY });
      const docs = await retriever.invoke(query.slice(0, 200));
      return docs.map(doc => `${doc.pageContent}\nSource: ${doc.metadata.source}`).join('\n\n---\n\n');
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { name: "tavily_search", description: "Search web for docs/errors.", schema: z.object({ query: z.string() }) }
);

// --- 2. FILE SYSTEM TOOLS ---
async function getFileTree(dir: string, depth = 0, maxDepth = 2): Promise<string> {
  if (depth > maxDepth) return "";
  try {
    const files = await fsp.readdir(dir);
    let output = "";
    for (const file of files) {
      if (['node_modules', '.git', 'dist'].includes(file)) continue; 
      const fullPath = path.join(dir, file);
      const stat = await fsp.stat(fullPath);
      output += `${"  ".repeat(depth)}|-- ${file}\n`;
      if (stat.isDirectory()) output += await getFileTree(fullPath, depth + 1, maxDepth);
    }
    return output;
  } catch (e) { return ""; }
}

export const listFilesTool = tool(
  async ({ dirPath, depth }) => getFileTree(path.resolve(CURRENT_WORKING_DIR, dirPath || "."), 0, depth || 2),
  { name: "list_files", description: "See project structure.", schema: z.object({ dirPath: z.string().optional(), depth: z.number().optional() }) }
);

export const readFileTool = tool(
  async ({ filePath, startLine, endLine }) => {
    try {
      const target = path.resolve(CURRENT_WORKING_DIR, filePath);
      const content = await fsp.readFile(target, 'utf-8');
      const lines = content.split('\n');
      const start = startLine ? startLine - 1 : 0;
      const end = endLine ? endLine : lines.length;
      return lines.slice(start, end).map((line, i) => `${start + i + 1}: ${line}`).join('\n');
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { name: "read_file", description: "Read file content.", schema: z.object({ filePath: z.string(), startLine: z.number().optional(), endLine: z.number().optional() }) }
);

export const writeFileTool = tool(
  async ({ filePath, content }) => {
    try {
      await fsp.writeFile(path.resolve(CURRENT_WORKING_DIR, filePath), content);
      return `✅ Successfully wrote to ${filePath}`;
    } catch (e: any) { return `Error: ${e.message}`; }
  },
  { name: "write_file", description: "Write file content.", schema: z.object({ filePath: z.string(), content: z.string() }) }
);

// --- 3. TERMINAL TOOL ---
export const terminalTool = tool(
  async ({ command }) => {
    try {
      if (command.includes('rm -rf') || command.includes('sudo')) return "❌ Blocked.";
      const { stdout, stderr } = await execAsync(command, { cwd: CURRENT_WORKING_DIR });
      return stdout || stderr || "✅ Executed.";
    } catch (e: any) { return `❌ Failed:\n${e.message}\nSTDERR:\n${e.stderr}`; }
  },
  { name: "terminal", description: "Run shell commands.", schema: z.object({ command: z.string() }) }
);

export const ALL_TOOLS = [listFilesTool, readFileTool, writeFileTool, searchTool, terminalTool];