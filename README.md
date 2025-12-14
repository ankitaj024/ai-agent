# Mao 🦁
### The Senior Developer Agent for your Terminal

**Mao** is a local, voice-enabled AI agent that lives in your terminal. Unlike standard chatbots, Mao has direct access to your filesystem, understands your project context, and helps you write code safely with built-in guardrails.

---

## 🚀 Features

* **🗣️ Voice-to-Code:** Press `v` and speak your intent. Mao transcribes it (using Whisper-large-v3) and executes it.
* **🛡️ Smart Diffs:** Never fly blind. Mao shows a color-coded Git-style diff (Green/Red) before editing any file.
* **🧠 Context Aware:** Automatically scans `package.json`, `requirements.txt`, and `README.md` on startup. It knows your tech stack immediately.
* **❤️‍🩹 Self-Healing:** If a command fails (e.g., `npm test`), Mao captures the error, analyzes it, and proposes a fix automatically.
* **🔍 Web Research:** Uses the Tavily API to fetch up-to-date docs and solutions when local knowledge isn't enough.

---

## 🛠️ Prerequisites

1.  **Node.js** (v18 or higher)
2.  **Groq API Key** (for LLM & Audio) - [Get it here](https://console.groq.com/)
3.  **Tavily API Key** (for Search) - [Get it here](https://tavily.com/)
4.  **SoX (Sound eXchange)** - Required for microphone access.

### Install SoX
* **Ubuntu/Debian:** `sudo apt install sox libsox-fmt-all`
* **MacOS:** `brew install sox`
* **Windows:** [Download Binaries](https://sourceforge.net/projects/sox/) and add to PATH.

---

## 📥 Installation

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/yourusername/mao.git](https://github.com/yourusername/mao.git)
    cd mao
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Setup Environment:**
    Create a `.env` file in the root directory:
    ```env
    GROQ_API_KEY=gsk_...
    TAVILY_API_KEY=tvly-...
    ```

4.  **Build & Link:**
    This compiles the TypeScript code and makes the `mao` command available globally.
    ```bash
    npm run build
    npm link
    ```


---

## 💻 Usage

### 1. Interactive Mode
Run the agent in any project folder:
```bash
mao