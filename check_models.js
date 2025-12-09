const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
const path = require("path");

// Load env
dotenv.config({ path: path.join(__dirname, '.env') });

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error("❌ No GOOGLE_API_KEY found in .env");
  process.exit(1);
}

console.log(`🔑 Using Key: ${apiKey.substring(0, 8)}...`);

async function checkModels() {
  // We use direct fetch to ask Google "What models do I have?"
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("❌ API Error:", data.error.message);
      return;
    }

    console.log("\n✅ AVAILABLE MODELS FOR YOUR KEY:");
    console.log("---------------------------------");
    const models = data.models || [];
    
    // Filter for models that support 'generateContent'
    const chatModels = models.filter(m => m.supportedGenerationMethods.includes("generateContent"));
    
    chatModels.forEach(m => {
      console.log(`Name: ${m.name.replace("models/", "")}`); // We remove the 'models/' prefix for the config
      console.log(`Description: ${m.description.substring(0, 60)}...`);
      console.log("---");
    });

  } catch (error) {
    console.error("❌ Network Error:", error);
  }
}

checkModels();