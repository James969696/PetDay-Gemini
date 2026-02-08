import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { promisify } from "util";

const execPromise = promisify(exec);
const EXEC_OPTIONS = { maxBuffer: 10 * 1024 * 1024 };

function deriveMediaStem(inputPath: string, fallback = 'video'): string {
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

async function getFileSize(filePath: string): Promise<number> {
    const isRemote = /^https?:\/\//i.test(filePath);
    if (!isRemote) {
        try {
            return fs.statSync(filePath).size;
        } catch {
            return 0;
        }
    }
    // For remote URLs, use ffprobe to get file size
    try {
        const cmd = `ffprobe -v error -show_entries format=size -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const { stdout } = await execPromise(cmd, EXEC_OPTIONS);
        return parseInt(stdout.trim()) || 0;
    } catch {
        return 0;
    }
}

const SIZE_THRESHOLD = 500 * 1024 * 1024; // 500MB

export async function createProxyVideo(originalPath: string, outputDir: string): Promise<string> {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const filename = deriveMediaStem(originalPath, `video-${Date.now()}`);
    const proxyPath = path.join(outputDir, `${filename}-proxy.mp4`);

    if (fs.existsSync(proxyPath)) {
        console.log(`[Timing] createProxyVideo: using cached proxy`);
        return proxyPath;
    }

    console.log(`[Timing] createProxyVideo started`);
    const proxyStart = Date.now();

    const isRemote = /^https?:\/\//i.test(originalPath);
    const fileSize = await getFileSize(originalPath);
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
    console.log(`[Proxy] Source: ${isRemote ? 'remote' : 'local'}, size: ${fileSizeMB}MB, threshold: 500MB`);

    try {
        if (fileSize > 0 && fileSize <= SIZE_THRESHOLD) {
            // ≤500MB: skip re-encode — use original directly or download without re-encoding
            if (!isRemote) {
                console.log(`[Proxy] ≤500MB local file — skipping proxy, using original directly`);
                console.log(`[Timing] createProxyVideo completed: ${formatDuration((Date.now() - proxyStart) / 1000)} (skipped)`);
                return originalPath;
            } else {
                // Remote URL: download to local without re-encoding (stream copy)
                console.log(`[Proxy] ≤500MB remote file — downloading without re-encode`);
                const command = `ffmpeg -i "${originalPath}" -c copy "${proxyPath}"`;
                await execPromise(command, { ...EXEC_OPTIONS, timeout: 300000 });
                console.log(`[Timing] createProxyVideo completed: ${formatDuration((Date.now() - proxyStart) / 1000)} (download only)`);
                return proxyPath;
            }
        } else {
            // >500MB (or unknown size): re-encode with bitrate cap to prevent file bloat
            console.log(`[Proxy] >500MB — re-encoding with bitrate cap`);

            // Get original bitrate to use as ceiling
            let originalBitrate = 2500000;
            try {
                const probeCmd = `ffprobe -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 "${originalPath}"`;
                const { stdout } = await execPromise(probeCmd, EXEC_OPTIONS);
                const parsed = parseInt(stdout.trim());
                if (parsed > 0) originalBitrate = parsed;
            } catch { /* use default */ }

            // Cap at original bitrate or 2.5Mbps, whichever is lower — ensures proxy is never bigger
            const targetBitrate = Math.min(originalBitrate, 2500000);
            console.log(`[Proxy] Original bitrate: ${(originalBitrate / 1000).toFixed(0)}kbps, target: ${(targetBitrate / 1000).toFixed(0)}kbps`);

            const command = `ffmpeg -i "${originalPath}" -vf "scale=-2:720" -c:v libx264 -b:v ${targetBitrate} -maxrate ${targetBitrate} -bufsize ${targetBitrate * 2} -preset fast -c:a aac -b:a 128k "${proxyPath}"`;
            await execPromise(command, { ...EXEC_OPTIONS, timeout: 600000 });
            console.log(`[Timing] createProxyVideo completed: ${formatDuration((Date.now() - proxyStart) / 1000)} (re-encoded)`);
            console.log("Compressed proxy video generated successfully.");
            return proxyPath;
        }
    } catch (error) {
        console.error("Error generating proxy video:", error);
        // Fallback: if transcoding fails, just use the original
        return originalPath;
    }
}

export async function extractFrame(videoPath: string, timestamp: string, outputDir: string, label: string): Promise<string> {
    const filename = deriveMediaStem(videoPath, `video-${Date.now()}`);
    const uniqueId = Math.random().toString(36).substring(7);
    const outputPath = path.join(outputDir, `${filename}-${label}-${uniqueId}.jpg`);

    console.log(`Extracting frame at ${timestamp} for ${label}`);

    // -ss timestamp -i input -vframes 1 captures one frame
    const command = `ffmpeg -y -ss ${timestamp} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`;

    try {
        await execPromise(command, EXEC_OPTIONS);
        return outputPath;
    } catch (error) {
        console.error(`Error extracting frame for ${label}:`, error);
        return "";
    }
}

export async function extractMosaicFrames(
    videoPath: string,
    centerTimestamp: string,
    outputDir: string,
    label: string,
    alternativeTimestamps?: { time: string; duration?: number }[]
): Promise<string[]> {
    const framePaths: string[] = [];

    // Determine frame extraction strategy based on alternative timestamps
    let frameTimestamps: number[];

    if (!alternativeTimestamps || alternativeTimestamps.length <= 1) {
        // Original behavior: 9 frames from T±2s window
        const baseSec = timeToSeconds(centerTimestamp);
        const offsets = [-2.0, -1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0];
        frameTimestamps = offsets.map(offset => Math.max(0, baseSec + offset));
        console.log(`[Mosaic] Extracting ${offsets.length} frames around ${centerTimestamp} for ${label}...`);
    } else {
        // Multi-timestamp strategy: use best_photo_timestamp (centerTimestamp) as primary
        // Sort all timestamps by duration (descending) for secondary selection
        const allTimestamps = alternativeTimestamps.map(t => ({
            time: t.time,
            seconds: timeToSeconds(t.time),
            duration: t.duration || 0
        })).sort((a, b) => b.duration - a.duration);

        frameTimestamps = [];

        // If centerTimestamp (best_photo_timestamp) differs from duration-primary by >1s,
        // use centerTimestamp as the real primary (it points to the best face moment)
        const centerSec = timeToSeconds(centerTimestamp);
        const durationPrimary = allTimestamps[0];
        const useBestPhoto = Math.abs(centerSec - durationPrimary.seconds) > 1.0;
        const primarySec = useBestPhoto ? centerSec : durationPrimary.seconds;

        // Primary: 5 frames covering ±1.5s (wider window to capture face in POV video)
        frameTimestamps.push(
            Math.max(0, primarySec - 1.5),
            Math.max(0, primarySec - 0.5),
            primarySec,
            Math.max(0, primarySec + 0.5),
            Math.max(0, primarySec + 1.5)
        );

        // Secondary: remaining timestamps each get 1 frame (total still 9)
        for (let i = 0; i < allTimestamps.length && frameTimestamps.length < 9; i++) {
            const ts = allTimestamps[i];
            // Skip timestamps too close to primary (already covered)
            if (Math.abs(ts.seconds - primarySec) < 2.0) continue;
            frameTimestamps.push(ts.seconds);
        }

        // Padding if still under 9 frames
        const paddingOffsets = [-2.5, 2.5, -3.5, 3.5];
        let paddingIdx = 0;
        while (frameTimestamps.length < 9 && paddingIdx < paddingOffsets.length) {
            frameTimestamps.push(Math.max(0, primarySec + paddingOffsets[paddingIdx]));
            paddingIdx++;
        }

        // Log the multi-timestamp extraction plan
        const timestampSources = allTimestamps.map(t => `${t.time}(${t.duration}s)`).join(', ');
        console.log(`[Mosaic] Multi-timestamp extraction for ${label}: sources=[${timestampSources}]`);
        console.log(`[Mosaic] Primary: ${useBestPhoto ? 'best_photo' : 'duration'}=${primarySec.toFixed(1)}s (center=${centerTimestamp}, durationPrimary=${durationPrimary.time})`);
        console.log(`[Mosaic] Frame timestamps: ${frameTimestamps.map(t => t.toFixed(1)).join(', ')}`);
    }

    // Extract all 9 frames in parallel for better performance
    const extractionPromises = frameTimestamps.map(async (adjustedSec, i) => {
        const uniqueId = Math.random().toString(36).substring(7);
        const framePath = path.join(outputDir, `${label}-mosaic-${i}-${uniqueId}.jpg`);

        try {
            await execPromise(`ffmpeg -y -ss ${adjustedSec} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`, EXEC_OPTIONS);
            return framePath;
        } catch (error) {
            console.error(`[Mosaic] Failed to extract frame ${i} at ${adjustedSec}s:`, error);
            // If a frame fails, return empty string to maintain index alignment
            return '';
        }
    });

    const extractedPaths = await Promise.all(extractionPromises);
    framePaths.push(...extractedPaths);

    return framePaths;
}

export async function createMosaic(
    framePaths: string[],
    outputPath: string
): Promise<string> {
    // Replace invalid frames in-place to preserve index alignment
    // (cellIndex from Gemini must map correctly to framePaths[cellIndex-1])
    const firstValid = framePaths.find(p => p && fs.existsSync(p)) || '';
    if (!firstValid) {
        throw new Error('[Mosaic] No valid frames available for mosaic creation');
    }
    const mosaicPaths = framePaths.map(p =>
        (p && fs.existsSync(p)) ? p : firstValid
    );
    // Ensure exactly 9 frames
    while (mosaicPaths.length < 9) mosaicPaths.push(firstValid);
    const validCount = framePaths.filter(p => p && fs.existsSync(p)).length;
    if (validCount < 9) {
        console.warn(`[Mosaic] Only ${validCount}/9 frames valid, substituted missing with first valid frame`);
    }

    const inputs = mosaicPaths.slice(0, 9).map(p => `-i "${p}"`).join(' ');
    const command = `ffmpeg -y ${inputs} -filter_complex "[0][1][2]hstack=3[row0];[3][4][5]hstack=3[row1];[6][7][8]hstack=3[row2];[row0][row1][row2]vstack=3" -q:v 2 "${outputPath}"`;

    console.log(`[Mosaic] Creating 3x3 grid: ${path.basename(outputPath)}`);

    try {
        await execPromise(command, EXEC_OPTIONS);
        return outputPath;
    } catch (error) {
        console.error(`[Mosaic] Failed to create mosaic:`, error);
        throw error;
    }
}

export async function cropImageWithBox(
    imagePath: string,
    box: [number, number, number, number],
    outputDir: string,
    label: string
): Promise<string> {
    const filename = path.basename(imagePath, path.extname(imagePath));
    const uniqueId = Math.random().toString(36).substring(7);
    const croppedPath = path.join(outputDir, `${filename}-${label}-cropped-${uniqueId}.jpg`);

    // Get image dimensions using ffprobe
    const probeCommand = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${imagePath}"`;
    let width = 1920, height = 1080;

    try {
        const { stdout } = await execPromise(probeCommand, EXEC_OPTIONS);
        const dims = stdout.trim().split('x').map(Number);
        if (dims.length === 2 && dims[0] > 0 && dims[1] > 0) {
            [width, height] = dims;
        }
    } catch (e) {
        console.error("Error getting image dimensions, using defaults:", e);
    }

    // Convert normalized box [ymin, xmin, ymax, xmax] (0-1000) to pixel coordinates
    // Apply 40% context buffer for better framing
    const ymin_raw = (box[0] / 1000) * height;
    const xmin_raw = (box[1] / 1000) * width;
    const ymax_raw = (box[2] / 1000) * height;
    const xmax_raw = (box[3] / 1000) * width;

    const w_raw = xmax_raw - xmin_raw;
    const h_raw = ymax_raw - ymin_raw;
    const paddingW = w_raw * 0.4;
    const paddingH = h_raw * 0.4;

    const xmin = Math.max(0, xmin_raw - paddingW);
    const ymin = Math.max(0, ymin_raw - paddingH);
    const xmax = Math.min(width, xmax_raw + paddingW);
    const ymax = Math.min(height, ymax_raw + paddingH);

    const cropW = Math.round(xmax - xmin);
    const cropH = Math.round(ymax - ymin);
    const cropX = Math.round(xmin);
    const cropY = Math.round(ymin);

    console.log(`[Crop] Cropping ${path.basename(imagePath)} with box [${box}] -> ${cropW}x${cropH}+${cropX}+${cropY}`);

    const cropCommand = `ffmpeg -y -i "${imagePath}" -vf "crop=${cropW}:${cropH}:${cropX}:${cropY}" -q:v 2 "${croppedPath}"`;

    try {
        await execPromise(cropCommand, EXEC_OPTIONS);
        // Cleanup the uncropped source frame
        try { fs.unlinkSync(imagePath); } catch (e) { }
        return croppedPath;
    } catch (error) {
        console.error(`[Crop] Crop failed, returning uncropped frame:`, error);
        return imagePath;
    }
}

export async function getVideoDimensions(videoPath: string): Promise<{ width: number, height: number }> {
    const command = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${videoPath}"`;
    try {
        const { stdout } = await execPromise(command, EXEC_OPTIONS);
        const [width, height] = stdout.trim().split('x').map(Number);
        return { width, height };
    } catch (e) {
        console.error("Error getting video dimensions:", e);
        return { width: 1920, height: 1080 }; // Fallback
    }
}

export async function extractAndCropFrame(
    videoPath: string,
    timestamp: string,
    fallbackBox: [number, number, number, number] | null,
    outputDir: string,
    label: string,
    validator?: (imagePath: string, hintBox?: [number, number, number, number]) => Promise<{ isPresent: boolean; confidence: number; box?: [number, number, number, number] }>,
    options: { useBurst: boolean } = { useBurst: true }
): Promise<string> {
    const extractStart = Date.now();
    const { width, height } = await getVideoDimensions(videoPath);

    const filename = path.basename(videoPath, path.extname(videoPath));
    const uniqueId = Math.random().toString(36).substring(7);

    // Stage 1: Extract frames (burst of 5 or single frame)
    const baseSeconds = timeToSeconds(timestamp);
    const offsets = options.useBurst ? [-1.0, -0.5, 0, 0.5, 1.0] : [0];

    console.log(`[Burst Capture] Sampling ${offsets.length} uncropped frames around ${timestamp} for ${label}...`);

    interface FrameCandidate {
        path: string;
        confidence: number;
        isPresent: boolean;
        box?: [number, number, number, number];
    }
    const candidates: FrameCandidate[] = [];

    for (let i = 0; i < offsets.length; i++) {
        const currentSS = Math.max(0, baseSeconds + offsets[i]);
        const burstPath = path.join(outputDir, `${filename}-${label}-burst-${i}-${uniqueId}.jpg`);

        // Extract UNCROPPED frame — no crop filter
        const command = `ffmpeg -y -ss ${currentSS} -i "${videoPath}" -vframes 1 -q:v 2 "${burstPath}"`;

        try {
            await execPromise(command, EXEC_OPTIONS);

            if (validator) {
                const validation = await validator(burstPath, fallbackBox || undefined);
                candidates.push({
                    path: burstPath,
                    confidence: validation.confidence,
                    isPresent: validation.isPresent,
                    box: validation.box
                });

                console.log(`[Burst Frame ${i}] offset=${offsets[i]}s, present=${validation.isPresent}, confidence=${validation.confidence}%, box=${validation.box || 'none'}`);
            } else {
                const stats = fs.statSync(burstPath);
                candidates.push({
                    path: burstPath,
                    confidence: stats.size,
                    isPresent: true
                });
            }
        } catch (error) {
            console.error(`Error in burst capture frame ${i}:`, error);
        }
    }

    // Select best frame: prioritize frames with animal present + highest confidence
    const validFrames = candidates.filter(c => c.isPresent);
    let bestFrame: FrameCandidate | undefined;

    if (validFrames.length > 0) {
        bestFrame = validFrames.reduce((a, b) => a.confidence > b.confidence ? a : b);
        console.log(`[Burst Capture] Selected best frame (${bestFrame.confidence}% confidence): ${path.basename(bestFrame.path)}, box=${bestFrame.box || 'none'}`);
    } else if (candidates.length > 0) {
        bestFrame = candidates.reduce((a, b) => a.confidence > b.confidence ? a : b);
        console.log(`[Burst Capture] WARNING: No animal detected, using best guess: ${path.basename(bestFrame?.path || '')}`);
    }

    // Cleanup non-selected burst frames
    for (const c of candidates) {
        if (c.path !== bestFrame?.path) {
            try { fs.unlinkSync(c.path); } catch (e) { }
        }
    }

    if (!bestFrame) {
        console.log(`[Timing] extractAndCropFrame: ${formatDuration((Date.now() - extractStart) / 1000)} (no frame)`);
        return "";
    }

    // Stage 2: Crop the best frame using its OWN box (or fallback)
    const boxToUse = bestFrame.box || fallbackBox;

    if (!boxToUse) {
        console.log(`[Burst Capture] No box available for cropping, returning uncropped frame`);
        console.log(`[Timing] extractAndCropFrame: ${formatDuration((Date.now() - extractStart) / 1000)} (uncropped)`);
        return bestFrame.path;
    }

    console.log(`[Burst Capture] Cropping best frame with box [${boxToUse}] (source: ${bestFrame.box ? 'per-frame detection' : 'fallback'})`);

    // Apply context buffer: expand box by 40%
    const ymin_raw = (boxToUse[0] / 1000) * height;
    const xmin_raw = (boxToUse[1] / 1000) * width;
    const ymax_raw = (boxToUse[2] / 1000) * height;
    const xmax_raw = (boxToUse[3] / 1000) * width;

    const w_raw = xmax_raw - xmin_raw;
    const h_raw = ymax_raw - ymin_raw;
    const paddingW = w_raw * 0.4;
    const paddingH = h_raw * 0.4;

    const xmin = Math.max(0, xmin_raw - paddingW);
    const ymin = Math.max(0, ymin_raw - paddingH);
    const xmax = Math.min(width, xmax_raw + paddingW);
    const ymax = Math.min(height, ymax_raw + paddingH);

    const cropW = Math.round(xmax - xmin);
    const cropH = Math.round(ymax - ymin);
    const cropX = Math.round(xmin);
    const cropY = Math.round(ymin);

    const croppedPath = path.join(outputDir, `${filename}-${label}-cropped-${uniqueId}.jpg`);
    const cropCommand = `ffmpeg -y -i "${bestFrame.path}" -vf "crop=${cropW}:${cropH}:${cropX}:${cropY}" -q:v 2 "${croppedPath}"`;

    try {
        await execPromise(cropCommand, EXEC_OPTIONS);
        // Cleanup uncropped frame
        try { fs.unlinkSync(bestFrame.path); } catch (e) { }
        console.log(`[Timing] extractAndCropFrame: ${formatDuration((Date.now() - extractStart) / 1000)} (cropped)`);
        return croppedPath;
    } catch (error) {
        console.error(`[Burst Capture] Crop failed, returning uncropped frame:`, error);
        console.log(`[Timing] extractAndCropFrame: ${formatDuration((Date.now() - extractStart) / 1000)} (crop failed)`);
        return bestFrame.path;
    }
}

function timeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

export async function getVideoDuration(videoPath: string): Promise<number> {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    try {
        const { stdout } = await execPromise(command, EXEC_OPTIONS);
        return parseFloat(stdout.trim()) || 0;
    } catch (error) {
        console.error(`Error getting video duration:`, error);
        return 0;
    }
}
