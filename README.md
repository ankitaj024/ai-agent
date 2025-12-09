# Global Dev Agent

A multi-agent AI development assistant built with LangGraph that helps you with coding tasks by intelligently routing between research and coding capabilities.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Set up environment variables:**
   Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and add your API keys:
   - `GOOGLE_API_KEY` (required): Get from https://aistudio.google.com/app/apikey
   - `TAVILY_API_KEY` (optional): Get from https://tavily.com/ for web search functionality

4. **Install globally (optional):**
   ```bash
   npm link
   ```
   This allows you to run `dev-agent` from any directory.

## Usage

Run the agent from any project directory:
```bash
dev-agent "your instruction here"
```

Or run interactively:
```bash
dev-agent
```

Type `exit` to quit.

## Workflow

The agent uses a **multi-agent architecture** with the following components:

### 1. **Supervisor Agent** 👨‍✈️
   - Acts as the central coordinator
   - Routes tasks to either the Researcher or Coder based on the task requirements
   - Decides when the task is complete (FINISH)

### 2. **Researcher Agent** 🔎
   - Searches the web for documentation, error solutions, or information
   - Uses Tavily Search API to find relevant information
   - Returns search results back to the supervisor

### 3. **Coder Agent** 💻
   - Performs coding tasks: reading files, writing files, listing directories, running terminal commands
   - Has access to these tools:
     - `list_files`: List files in a directory
     - `read_file`: Read file contents
     - `write_file`: Write/overwrite files (⚠️ requires approval)
     - `terminal`: Execute shell commands (⚠️ requires approval)

### Safety Features

- **Approval Gate**: Before executing potentially dangerous operations (write_file, terminal), the agent pauses and asks for your approval
- **Working Directory**: Always operates in the directory where you ran the command
- **State Persistence**: Uses SQLite checkpointing to maintain conversation state

## Architecture Flow

```
START → Supervisor
         ↓
    ┌────┴────┐
    │         │
Researcher  Coder
    ↓         ↓
Research   Coding
Tools      Tools
    ↓         ↓
    └────┬────┘
         ↓
    Supervisor
         ↓
    FINISH/END
```

## Project Structure

- `src/cli.ts` - Main application code with agent definitions
- `dist/cli.js` - Compiled JavaScript output
- `agent_memory.db` - SQLite database for conversation state (auto-created)
- `.env` - Environment variables (create this file)

## How It Works

1. User provides an instruction
2. Supervisor analyzes the request and routes to Researcher or Coder
3. If Researcher: searches web and returns results
4. If Coder: may use tools (with approval gates for dangerous operations)
5. Results flow back to Supervisor
6. Process repeats until Supervisor decides task is complete
