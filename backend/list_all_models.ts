
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../petday---ai-pet-pov-insights/.env.local') });

const apiKey = process.env.GEMINI_API_KEY;

async function listModels() {
    if (!apiKey) return;

    console.log("正在从 REST API 获取模型列表...");
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("❌ API 错误:", data.error.message);
            return;
        }

        console.log("✅ 可用模型列表:");
        data.models.forEach((m: any) => {
            console.log(`- ${m.name.replace('models/', '')} (${m.supportedGenerationMethods.join(', ')})`);
        });
    } catch (error) {
        console.error("❌ 请求失败:", (error as Error).message);
    }
}

listModels();
