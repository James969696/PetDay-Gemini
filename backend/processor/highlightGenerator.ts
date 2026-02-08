import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import type { AnalysisResult } from "./videoAnalyzer.ts";

const execPromise = promisify(exec);
const EXEC_OPTIONS = { maxBuffer: 10 * 1024 * 1024 };

function deriveMediaStem(inputPath: string, fallback = 'video') {
    if (!inputPath) return fallback;
    let sourcePath = inputPath;
    if (/^https?:\/\//i.test(inputPath)) {
        try {
            sourcePath = new URL(inputPath).pathname;
        } catch {
            sourcePath = inputPath;
        }
    }
    const stem = path.basename(sourcePath, path.extname(sourcePath))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return stem || fallback;
}

// Helper to format duration for timing logs
function formatDuration(seconds: number): string {
    if (seconds >= 60) {
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m}m ${s}s`;
    }
    return `${seconds.toFixed(1)}s`;
}

async function isPlayableVideo(filePath: string): Promise<boolean> {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
        const probeCmd = `ffprobe -v error -show_entries stream=codec_type -show_entries format=duration -of json "${filePath}"`;
        const { stdout } = await execPromise(probeCmd, EXEC_OPTIONS);
        const parsed = JSON.parse(stdout || "{}");
        const duration = Number(parsed?.format?.duration || 0);
        const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
        const hasVideoStream = streams.some((s: any) => s?.codec_type === "video");
        return duration > 0.1 && hasVideoStream;
    } catch (error) {
        console.error("Error validating highlight file with ffprobe:", error);
        return false;
    }
}

export async function generateHighlights(
    videoPath: string,
    analysis: AnalysisResult,
    outputDirOverride?: string,
    outputNamePrefix?: string
): Promise<string | null> {
    const highlightStart = Date.now();
    console.log("[Timing] generateHighlights started");
    console.log("Generating highlights for:", videoPath);

    if (!analysis.highlightTimestamps || analysis.highlightTimestamps.length === 0) {
        console.warn("No highlights found in analysis.");
        return null;
    }

    // Calculate and log total duration
    const parseTime = (t: string) => {
        const [m, s] = t.split(':').map(Number);
        return m * 60 + s;
    };
    const totalDuration = analysis.highlightTimestamps.reduce((sum, ts) => {
        return sum + (parseTime(ts.end) - parseTime(ts.start));
    }, 0);
    console.log(`[Highlight Generator] Processing ${analysis.highlightTimestamps.length} clips, total duration: ${totalDuration}s`);

    if (totalDuration > 120) {
        console.warn(`[Highlight Generator] WARNING: Duration ${totalDuration}s exceeds 120s limit`);
    }

    const outputDir = outputDirOverride || path.dirname(videoPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const baseName = outputNamePrefix || deriveMediaStem(videoPath, `video-${Date.now()}`);
    const filename = deriveMediaStem(baseName, `video-${Date.now()}`);
    const finalHighlightPath = path.join(outputDir, `${filename}-highlights.mp4`);

    const tempFiles: string[] = [];

    try {
        // 1. Extract each segment using FFmpeg (parallel for speed)
        let extractStart = Date.now();
        const segmentPromises = analysis.highlightTimestamps.map(async (ts, i) => {
            const segmentPath = path.join(outputDir, `temp_segment_${i}.mp4`);
            const cmd = `ffmpeg -y -ss ${ts.start} -to ${ts.end} -i "${videoPath}" -c:v libx264 -preset ultrafast -crf 23 -c:a aac "${segmentPath}"`;
            console.log(`Extracting segment ${i}: ${ts.start} to ${ts.end}`);
            await execPromise(cmd, EXEC_OPTIONS);
            return segmentPath;
        });
        tempFiles.push(...await Promise.all(segmentPromises));
        console.log(`[Timing] Highlight segment extraction: ${formatDuration((Date.now() - extractStart) / 1000)} (${tempFiles.length} segments, parallel)`);

        // 2. Concatenate segments
        let concatStart = Date.now();
        const listFilePath = path.join(outputDir, "segments.txt");
        const listContent = tempFiles.map(f => `file '${f}'`).join("\n");
        fs.writeFileSync(listFilePath, listContent);

        console.log("Concatenating segments...");
        const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy -movflags +faststart "${finalHighlightPath}"`;
        await execPromise(concatCmd, EXEC_OPTIONS);
        console.log(`[Timing] Highlight concatenation: ${formatDuration((Date.now() - concatStart) / 1000)}`);

        const playable = await isPlayableVideo(finalHighlightPath);
        if (!playable) {
            console.error("[Highlight Generator] Output highlight is not playable (black/invalid file).");
            if (fs.existsSync(finalHighlightPath)) fs.unlinkSync(finalHighlightPath);
            throw new Error("Generated highlight file is invalid");
        }

        // 3. Cleanup
        for (const f of tempFiles) fs.unlinkSync(f);
        fs.unlinkSync(listFilePath);

        const totalHighlightTime = (Date.now() - highlightStart) / 1000;
        console.log(`[Timing] generateHighlights total: ${formatDuration(totalHighlightTime)}`);
        console.log("Highlight reel generated:", finalHighlightPath);
        return finalHighlightPath;

    } catch (error) {
        console.error("Error generating highlights:", error);
        // Cleanup on error
        for (const f of tempFiles) { if (fs.existsSync(f)) fs.unlinkSync(f); }
        return null;
    }
}
