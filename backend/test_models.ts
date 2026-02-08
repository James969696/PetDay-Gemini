
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../petday---ai-pet-pov-insights/.env.local') });

const apiKey = process.env.GEMINI_API_KEY;

async function testModels() {
    if (!apiKey) return;
    const genAI = new GoogleGenerativeAI(apiKey);

    const models = ["gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-pro", "gemini-pro"];

    for (const modelName of models) {
        console.log(`正在测试模型: ${modelName}...`);
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("你好");
            console.log(`✅ ${modelName} 成功:`, result.response.text().substring(0, 20));
            break;
        } catch (error) {
            console.error(`❌ ${modelName} 失败:`, (error as Error).message);
        }
    }
}

testModels();
