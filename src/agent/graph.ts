import { ChatGroq } from "@langchain/groq";
import { StateGraph, END, Annotation, START } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SystemMessage, BaseMessage, AIMessage } from "@langchain/core/messages";
import { ENV } from '../config/env';
import { ALL_TOOLS } from '../tools';
import { loadProjectContext } from '../utils/io';

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (x, y) => x.concat(y) }),
});

const llm = new ChatGroq({
  model: ENV.MODEL_NAME,
  temperature: 0,
  apiKey: ENV.GROQ_API_KEY,
});

const agentNode = async (state: typeof AgentState.State) => {
  const nodeLLM = llm.bindTools(ALL_TOOLS);
  const projectContext = await loadProjectContext();

  const systemMsg = new SystemMessage(`
    You are a Senior Developer Assistant.
    Current Dir: ${process.cwd()}
    
    PROJECT CONTEXT:
    ${projectContext}

    CAPABILITIES:
    1. **See:** Use 'list_files' and 'read_file'.
    2. **Research:** Use 'tavily_search'.
    3. **Act:** Use 'write_file' and 'terminal'.

    RULES:
    - Check files before editing.
    - If a command fails, read the error and try to fix it.
  `);

  const response = await nodeLLM.invoke([systemMsg, ...state.messages]);
  return { messages: [response] };
};

export function createAgentGraph(checkpointer: any) {
  const workflow = new StateGraph(AgentState)
    .addNode("Agent", agentNode)
    .addNode("tools", new ToolNode(ALL_TOOLS))
    .addEdge(START, "Agent")
    .addConditionalEdges("Agent", (state) => {
      const lastMsg = state.messages[state.messages.length - 1];
      return (lastMsg instanceof AIMessage && lastMsg.tool_calls?.length) ? "tools" : END;
    })
    .addEdge("tools", "Agent");

  return workflow.compile({ checkpointer, interruptBefore: ["tools"] });
}