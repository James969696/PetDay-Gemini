
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../petday---ai-pet-pov-insights/.env.local') });

const apiKey = process.env.GEMINI_API_KEY;

async function listModels() {
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
        console.error("❌ 错误: .env.local 文件中的 GEMINI_API_KEY 仍为占位符或为空。");
        return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        const result = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent("test");
        console.log("✅ getGenerativeModel works");
    } catch (e) {
        console.log("❌ getGenerativeModel failed, checking listModels...");
    }

    // The SDK doesn't have a direct listModels in the main class easily accessible sometimes depending on version
    // but we can try to find why gemini-1.5-flash is 404ing.
    // Actually, let's try 'gemini-1.5-flash-latest' as well.
}

listModels();
