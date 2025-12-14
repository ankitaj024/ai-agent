#!/usr/bin/env node
import * as path from 'path';
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { createAgentGraph } from './agent/graph';
import { askQuestion } from './utils/io';
import { captureVoice } from './utils/voice';
import { showDiff } from './utils/diff';
import { clr, printStream } from './utils/formatting';

async function main() {
  const memory = SqliteSaver.fromConnString(path.resolve(__dirname, "../agent_memory.db"));
  const app = createAgentGraph(memory);
  const config = { configurable: { thread_id: "dev-session-v1" } };

  console.log(`\n${clr.green}👨‍💻 Senior Dev Agent Active${clr.reset}`);
  
  let userInput = process.argv[2] || await askQuestion(`\n${clr.bright}Instruct (or 'v' for voice):${clr.reset} `);

  while (true) {
    if (userInput.toLowerCase() === 'exit') break;

    // --- VOICE HANDLING ---
    if (userInput.toLowerCase() === 'v') {
      try {
        const text = await captureVoice();
        console.log(`${clr.green}🗣️  Recognized:${clr.reset} "${text}"`);
        userInput = await askQuestion(`${clr.bright}Edit/Confirm:${clr.reset} `, text);
      } catch (e: any) {
        console.log("Voice Error:", e.message);
        userInput = await askQuestion(`\n${clr.bright}Instruct:${clr.reset} `);
        continue;
      }
    }

    // --- AGENT LOOP ---
    await printStream(await app.stream({ messages: [new HumanMessage(userInput)] }, config));

    while (true) {
      const snapshot = await app.getState(config);
      if (!snapshot.next.includes("tools")) break;

      const lastMsg = snapshot.values.messages.slice(-1)[0] as AIMessage;
      const toolCall = lastMsg.tool_calls?.[0];

      if (toolCall) {
        console.log(`${clr.yellow}⚡ Agent wants to: ${clr.bright}${toolCall.name}${clr.reset}`);
        
        if (toolCall.name === 'write_file') {
          showDiff((toolCall.args as any).filePath, (toolCall.args as any).content);
        } else {
          console.log(`${clr.dim}Args: ${JSON.stringify(toolCall.args)}${clr.reset}`);
        }

        const allow = await askQuestion(`\n${clr.red}⚠️  Approve? (y/n) ${clr.reset}`);
        if (allow.toLowerCase() === 'y') {
          await printStream(await app.stream(null, config));
        } else {
          console.log("❌ Denied.");
          break;
        }
      }
    }
    userInput = await askQuestion(`\n${clr.bright}Next:${clr.reset} `);
  }
}

main();