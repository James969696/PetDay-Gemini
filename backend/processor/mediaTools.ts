import { createRequire } from 'module';
import { exec } from 'child_process';
import { promisify } from 'util';

const require = createRequire(import.meta.url);
const execPromise = promisify(exec);
const EXEC_OPTIONS = { maxBuffer: 10 * 1024 * 1024 };

function resolveFfmpeg(): string {
    try {
        const value = require('ffmpeg-static');
        if (typeof value === 'string' && value) return value;
    } catch { /* fall back to PATH */ }
    return 'ffmpeg';
}

function resolveFfprobe(): string {
    try {
        const value = require('ffprobe-static');
        if (value?.path) return value.path;
        if (typeof value === 'string' && value) return value;
    } catch { /* fall back to PATH */ }
    return 'ffprobe';
}

function shellQuote(value: string): string {
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}

export const FFMPEG_CMD = shellQuote(resolveFfmpeg());
export const FFPROBE_CMD = shellQuote(resolveFfprobe());

export async function readMediaInfo(filePath: string): Promise<string> {
    try {
        const { stdout, stderr } = await execPromise(`${FFMPEG_CMD} -hide_banner -i "${filePath}"`, EXEC_OPTIONS);
        return `${stdout}\n${stderr}`;
    } catch (error: any) {
        return `${error?.stdout || ''}\n${error?.stderr || ''}`;
    }
}

export function parseDurationFromMediaInfo(info: string): number {
    const match = info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const total = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) ? total : 0;
}

export function parseDimensionsFromMediaInfo(info: string): { width: number; height: number } | null {
    const matches = [...info.matchAll(/,\s*(\d{2,5})x(\d{2,5})(?:[,\s]|$)/g)];
    for (const match of matches) {
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return { width, height };
        }
    }
    return null;
}
