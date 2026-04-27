import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.basename(__dirname) === 'dist'
  ? path.resolve(__dirname, '..')
  : __dirname;

dotenv.config({ path: path.resolve(backendRoot, '../petday---ai-pet-pov-insights/.env.local') });

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  uploadDir: path.resolve(backendRoot, './uploads'),
  outputDir: path.resolve(backendRoot, './outputs'),
  isCloud: false,
};

if (!config.geminiApiKey || config.geminiApiKey === 'PLACEHOLDER_API_KEY') {
  console.warn('WARNING: GEMINI_API_KEY is not set or is a placeholder. Please check your .env.local file.');
}
