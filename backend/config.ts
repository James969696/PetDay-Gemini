import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../petday---ai-pet-pov-insights/.env.local') });

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  uploadDir: path.resolve(__dirname, './uploads'),
  outputDir: path.resolve(__dirname, './outputs'),
  isCloud: false,
};

if (!config.geminiApiKey || config.geminiApiKey === 'PLACEHOLDER_API_KEY') {
  console.warn('WARNING: GEMINI_API_KEY is not set or is a placeholder. Please check your .env.local file.');
}
