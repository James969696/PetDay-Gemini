
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../petday---ai-pet-pov-insights/.env.local') });

const apiKey = process.env.GEMINI_API_KEY;

async function testKey() {
    if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
        console.error("❌ 错误: .env.local 文件中的 GEMINI_API_KEY 仍为占位符或为空。");
        return;
    }

    console.log(`正在使用 Key 进行测试: ${apiKey.substring(0, 8)}...`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    try {
        const result = await model.generateContent("你好，请回复 'API Key 正常' 如果你能看到这条消息。");
        console.log("✅ 响应成功:", result.response.text());
    } catch (error) {
        console.error("❌ API Key 验证失败:", (error as Error).message);
    }
}

testKey();
