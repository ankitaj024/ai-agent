import { config } from 'dotenv';
import * as path from 'path';

// Load .env from project root
const packageRoot = path.resolve(__dirname, '..', '..');
config({ path: path.join(packageRoot, '.env') });

export const ENV = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  MODEL_NAME: "llama-3.3-70b-versatile",
  AUDIO_MODEL: "whisper-large-v3"
};

if (!ENV.GROQ_API_KEY) {
  console.error("❌ Error: GROQ_API_KEY is missing in .env");
  process.exit(1);
}