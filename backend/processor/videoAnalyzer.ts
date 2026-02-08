import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { config } from "../config.ts";
import fs from "fs";
import path from "path";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const fileManager = new GoogleAIFileManager(config.geminiApiKey);

function readPositiveIntEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] || '');
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.floor(raw);
}

const GEMINI_UPLOAD_TIMEOUT_MS = readPositiveIntEnv('GEMINI_UPLOAD_TIMEOUT_MS', 4 * 60 * 1000);
const GEMINI_UPLOAD_ATTEMPTS = readPositiveIntEnv('GEMINI_UPLOAD_ATTEMPTS', 2);
const GEMINI_GETFILE_TIMEOUT_MS = readPositiveIntEnv('GEMINI_GETFILE_TIMEOUT_MS', 20 * 1000);
const GEMINI_GETFILE_ATTEMPTS = readPositiveIntEnv('GEMINI_GETFILE_ATTEMPTS', 2);
const GEMINI_GETFILE_POLL_MAX_RETRIES = readPositiveIntEnv('GEMINI_GETFILE_POLL_MAX_RETRIES', 60);
const GEMINI_GENERATE_TIMEOUT_MS = readPositiveIntEnv('GEMINI_GENERATE_TIMEOUT_MS', 6 * 60 * 1000);
const GEMINI_GENERATE_ATTEMPTS = readPositiveIntEnv('GEMINI_GENERATE_ATTEMPTS', 2);
const GEMINI_IMAGE_TIMEOUT_MS = readPositiveIntEnv('GEMINI_IMAGE_TIMEOUT_MS', 45 * 1000);
const GEMINI_IMAGE_ATTEMPTS = readPositiveIntEnv('GEMINI_IMAGE_ATTEMPTS', 2);

export interface AnalysisResult {
    title: string;
    aiNote: string;
    narrativeSegments: { text: string; timestamp: string }[];
    moodData: { name: string; value: number; originalTime?: string }[];
    moodDataHighlight?: { name: string; value: number; originalTime?: string }[];
    scenery: { description: string; timestamp: string; url?: string; sceneryLabel?: string; stayDuration?: number }[];
    friends: {
        name: string;
        type: string;
        timestamp: string;  // Primary timestamp (first/best interaction)
        best_photo_timestamp?: string;  // Best moment for portrait/avatar (face visible, camera level)
        timestamps?: { time: string; duration?: number }[];  // All interaction timestamps
        box?: [number, number, number, number];
        url?: string;
        visual_traits?: string;  // 3-5 visual trait words for identity (e.g., "orange tabby, white paws, green eyes")
        interactionNature?: string;
        duration?: number;  // Total duration across all interactions
        frequency?: number;
        relationshipStatus?: 'Bestie' | 'Soulmate' | 'Rival' | 'Acquaintance';
    }[];
    timeline: { time: string; label: string; icon: string }[];
    timelineHighlight?: { time: string; label: string; icon: string; originalTime?: string }[];
    highlightTimestamps: {
        start: string;
        end: string;
        reason?: string;
        score?: number;
        source?: string;
        friendName?: string;
        isHighQuality?: boolean;
        isNearFriend?: boolean;
    }[];
    safetyAlerts?: { type: 'warning' | 'danger'; message: string; timestamp: string }[];
    dietaryHabits?: { item: string; action: 'eating' | 'drinking'; timestamp: string; url?: string }[];
    coverTimestamp?: string;
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

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
    label: string,
    action: () => Promise<T>,
    timeoutMs: number
): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            action(),
            new Promise<T>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

function isRetryableGeminiError(error: unknown): boolean {
    const message = String((error as Error)?.message || error || '').toLowerCase();
    return (
        message.includes('fetch failed') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('timeout') ||
        message.includes('socket hang up') ||
        message.includes('temporarily unavailable') ||
        message.includes('503') ||
        message.includes('429')
    );
}

async function withRetry<T>(
    label: string,
    action: () => Promise<T>,
    attempts = 3,
    initialDelayMs = 3000
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await action();
        } catch (error) {
            lastError = error;
            const canRetry = attempt < attempts && isRetryableGeminiError(error);
            if (!canRetry) break;
            const delayMs = initialDelayMs * attempt;
            console.warn(`[Retry] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms: ${(error as Error).message}`);
            await sleep(delayMs);
        }
    }
    throw lastError;
}

export async function analyzeVideo(videoPath: string): Promise<AnalysisResult> {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
    const analyzeStart = Date.now();

    console.log(`[Timing] analyzeVideo started`);
    console.log(`Uploading video to Gemini File API: ${videoPath}`);

    // Stage A: File Upload
    let stageStart = Date.now();
    const uploadResult = await withRetry(
        "Gemini uploadFile",
        () => withTimeout("Gemini uploadFile", () => fileManager.uploadFile(videoPath, {
            mimeType: "video/mp4",
            displayName: "Pet POV Video",
        }), GEMINI_UPLOAD_TIMEOUT_MS),
        GEMINI_UPLOAD_ATTEMPTS,
        5000
    );

    const fileUri = uploadResult.file.uri;
    const fileName = uploadResult.file.name;
    console.log(`[Timing] Gemini file upload: ${formatDuration((Date.now() - stageStart) / 1000)}`);

    console.log(`File uploaded. waiting for processing... URI: ${fileUri}`);

    // Stage B: Wait for Gemini file processing
    stageStart = Date.now();
    let file = await withRetry(
        "Gemini getFile",
        () => withTimeout("Gemini getFile", () => fileManager.getFile(fileName), GEMINI_GETFILE_TIMEOUT_MS),
        GEMINI_GETFILE_ATTEMPTS,
        2000
    );
    let retries = 0;
    const maxRetries = GEMINI_GETFILE_POLL_MAX_RETRIES;
    while (file.state === "PROCESSING") {
        if (retries++ >= maxRetries) {
            const maxWaitMinutes = Math.round((maxRetries * 5) / 60);
            throw new Error(`Video processing timed out after ${maxWaitMinutes} minutes.`);
        }
        process.stdout.write(".");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        file = await withRetry(
            "Gemini getFile",
            () => withTimeout("Gemini getFile", () => fileManager.getFile(fileName), GEMINI_GETFILE_TIMEOUT_MS),
            GEMINI_GETFILE_ATTEMPTS,
            2000
        );
    }

    if (file.state === "FAILED") {
        throw new Error("Video processing failed in Gemini File API.");
    }
    console.log(`\n[Timing] Gemini file processing wait: ${formatDuration((Date.now() - stageStart) / 1000)} (${retries} retries)`);

    console.log("Video ready for analysis.");

    const prompt = `
Analyze this pet POV video and provide a detailed report (English only). Include:

1. Title: A catchy title for the highlight reel.
2. AI Note (aiNote): Narrative summary from the pet's perspective.
3. Narrative Segments (narrativeSegments: [{text, timestamp MM:SS}]): Timed subtitle segments from the pet's POV.
   - Generate one subtitle for EVERY distinct scene or visual change in the video. Do NOT skip any scene.
   - A "scene" = any change in location, activity, subject, or camera focus (even if it lasts only 2-3 seconds).
   - No fixed time interval or quantity limit — let the actual video content dictate the number of cues.
   - Write in the first person as the pet wearing the camera. Use a warm, curious, playful tone (e.g., "Ooh, what's that smell over there?", "Wait… is that my buddy Coco?!", "This view is amazing!").
4. Mood Data (moodData: [{name: MM:SS, value: 0-100}]): Emotional intensity, **Total ~30 points** evenly distributed across the duration (e.g., if 6min video, sample every ~12s; if 60min, every ~2min).
5. Favorite Views (scenery: [{description, timestamp MM:SS, sceneryLabel, stayDuration}]):
   - Definition: Moments of **Visual Appreciation** where the camera focuses on the environment rather than immediate action.
   - Look for these Camera Behaviors (2+ seconds):
     1. **The Reliable Gaze**: Camera is relatively steady, focusing on a specific object or scene.
     2. **The Smooth Pan**: Camera moves slowly and smoothly across a landscape (e.g., scanning a mountain range, looking up at trees). *Crucial for capturing vast scenery.*
     3. **The Walk-and-Gaze**: Forward movement is present, but the camera angle is tilted UP or fixed on the horizon, distinct from the shaky ground-focus of sniffing/tracking.
   - Subject Matter: Distant horizons, light/shadow play, nature details, architecture, or open spaces.
   - Exclude: Ground sniffing, chaotic shaking, or interactions with animals/humans.
   - Labels: Use catchy US-style names (e.g., "Sweeping Vista", "Alpine Gaze", "Golden Hour", "Sky Patrol").
   - stayDuration: The duration in seconds of ONE CONTINUOUS camera behavior (gaze, pan, or walk-and-gaze). If the pet looks away then looks back, count each look separately as a different scenery entry. Typical range is 2-10s; values above 15s are extremely rare.
6. Friends (friends: [{name, type, timestamp MM:SS, best_photo_timestamp MM:SS, timestamps: [{time, duration}], box: [ymin,xmin,ymax,xmax] (0-1000), visual_traits, interactionNature, duration, frequency, relationshipStatus}]):
   - type: Use the SPECIFIC BREED (e.g., "Golden Retriever", "Tabby Cat", "Maine Coon", "Siamese Cat", "Labrador", "Corgi", "Persian Cat", "Pomeranian"). If the breed is uncertain, give your best guess. Never use generic labels like "Dog" or "Cat".
   - Include EVERY animal — even brief (2-3s), partial, or distant appearances.
   - Include animals the pet observes from a distance without direct interaction — these are still Friends, not Scenery.
   - Distinguish individuals by visual traits. If in doubt, include it.
   - timestamps: ALL separate appearances. frequency = timestamps count. duration = total visible seconds.
   - box: bounding box at the main timestamp (best/clearest moment).
   - best_photo_timestamp: The moment where this animal's FACE/HEAD is most clearly visible and facing the camera — ideal for a portrait/avatar photo. This may differ from timestamp (which is the best interaction moment). For pet-mounted POV cameras, look for moments when the camera is level/looking forward at the animal, NOT looking down at the ground during sniffing.
   - visual_traits: 3-5 visual trait words describing this specific animal's appearance (e.g., "orange tabby, white paws, green eyes"). Used for precise identification to distinguish from other similar animals.
   - relationshipStatus: "Bestie", "Soulmate", "Rival", or "Acquaintance".
7. Activity Timeline (timeline: [{time MM:SS, label, icon}]):
   - **STRICTLY 15-20 entries** regardless of video length (minimum 15, maximum 20). Summarize!
   - For long videos, group repetitive events. Do NOT produce hundreds of entries.
   - Prioritize: Social interactions > Hunting > Emotional moments > Exploration > Resting.
   - Convert each into a catchy 2-4 word "Movie Chapter Title" with warm, humorous tone.
   - Icon MUST be one of: visibility, pets, directions_walk, directions_run, favorite, explore, speed, park, home, restaurant, bolt, terrain, forest, brush, groups, stairs, waves, search, wb_sunny, nightlight_round, sports_score, trending_up, trending_down, straighten, room, auto_fix_high, grass, meeting_room, roofing, south, error, timeline.
8. Highlight Timestamps: Create a highlight reel as highlightTimestamps: [{start, end, reason, score}].
   Duration: Target ~60s, never exceed 120s total.
   Guidelines:
   - Include at least 1 clip overlapping each friend timestamp (can be short).
   - Include at least 1 clip for scenery moments with stayDuration ≥ 3s (the pet's contemplative gaze is a key personality moment).
   - Prioritize clips where a friend and beautiful scenery appear together or near each other (e.g., pets gazing at a view, sitting with a friend overlooking a landscape). These friend+scenery combinations are the most emotionally impactful moments.
   - When multiple scenery moments exist, prefer the most visually stunning one for highlight inclusion.
   - Prefer clips 2-6s; avoid >8s unless score ≥ 4 in at least 3 dimensions.
   - Ensure variety.
   Scoring (0-5 each dimension):
   - Cuteness / Emotion: heartwarming moments, expressions, reactions
   - Interaction: meaningful engagement with friends, humans, or objects
   - Action / Energy: movement, play, chase, exploration
   - Story Value: moments that advance the narrative or show personality
   - Scenic / Atmosphere: visual beauty, wide landscapes, calm gazing moments, sense of wonder
   Selection rule:
   - Maximize total score while satisfying friend AND scenery coverage.
   - If a friend clip scores low, still include it but keep it short (2-3s).
   - Include at least one scenic moment — the pet's quiet appreciation is part of the story.
9. Safety Alerts (safetyAlerts: [{type: "warning"|"danger", message, timestamp MM:SS}]):
   IMPORTANT: Consider the pet's natural abilities. Many species-typical behaviors (jumping, climbing, running, swimming) are NOT safety concerns.

   "danger" - Life-threatening situations requiring immediate attention:
   * Severe falls from heights exceeding the pet's safe landing capability
   * Aggressive attacks from other animals with visible injury risk (biting, clawing, fighting)
   * Active traffic or vehicle proximity
   * Exposure to toxic substances (antifreeze, chemicals, poisonous plants)
   * Drowning risk, extreme heat/cold exposure, or other environmental hazards
   * Signs of injury, pain, or distress (limping, bleeding, difficulty breathing)

   "warning" - Potentially risky situations to be aware of:
   * Tense confrontations with other animals (growling, hissing, posturing - no physical contact yet)
   * Hunting or chasing wild animals (potential bite/scratch risk)
   * Navigating unstable, slippery, or precarious surfaces
   * Entering confined spaces with potential entrapment risk
   * Unusually risky jumps or movements for the species

   DO NOT flag as alerts (normal pet behaviors):
   * Species-appropriate jumping, climbing, running, or swimming
   * Walking on elevated surfaces within the pet's natural ability
   * Play-fighting or roughhousing with familiar companions
   * Normal exploration, sniffing, or territorial behavior
   * Standard chase/play activities
10. Dietary Habits (dietaryHabits: [{item, action: "eating"|"drinking", timestamp MM:SS}]).
11. Cover Timestamp (coverTimestamp: MM:SS): Most visually interesting moment. Avoid blurry frames.

    Output the result EXACTLY in this JSON structure:
    {
      "title": "",
      "aiNote": "",
      "narrativeSegments": [{"text": "Oh, look at that sunrise!", "timestamp": "00:05"}],
      "moodData": [{"name": "00:00", "value": 50}],
      "scenery": [{
        "description": "Golden sunset at the park", 
        "timestamp": "01:22",
        "sceneryLabel": "Zen Zone",
        "stayDuration": 45
      }],
      "friends": [{
        "name": "Coby",
        "type": "Golden Retriever",
        "timestamp": "00:45",
        "timestamps": [
          {"time": "00:45", "duration": 8},
          {"time": "01:30", "duration": 7}
        ],
        "box": [200, 300, 600, 700],
        "visual_traits": "golden retriever, floppy ears, brown eyes, red collar",
        "interactionNature": "Playful chasing and tail wagging",
        "duration": 15,
        "frequency": 2,
        "relationshipStatus": "Bestie"
      }]
      "timeline": [{"time": "00:00", "label": "Waking up", "icon": "wb_sunny"}],
      "highlightTimestamps": [{"start": "00:00", "end": "00:06", "reason": "Excited greeting with best friend", "score": 18}],
      "safetyAlerts": [{"type": "warning", "message": "High jump detected", "timestamp": "00:30"}],
      "dietaryHabits": [{"item": "Water", "action": "drinking", "timestamp": "02:15"}],
      "coverTimestamp": "01:30"
    }
  `;

    try {
        // Stage C: Gemini generateContent (AI analysis)
        stageStart = Date.now();
        const result = await withRetry(
            "Gemini generateContent",
            () => withTimeout("Gemini generateContent", () => model.generateContent([
                {
                    fileData: {
                        mimeType: file.mimeType,
                        fileUri: file.uri,
                    },
                },
                prompt,
            ]), GEMINI_GENERATE_TIMEOUT_MS),
            GEMINI_GENERATE_ATTEMPTS,
            5000
        );
        console.log(`[Timing] Gemini generateContent: ${formatDuration((Date.now() - stageStart) / 1000)}`);

        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Failed to parse JSON from Gemini response");

        const analysis = JSON.parse(jsonMatch[0]);

        // Clean up the file from the API after analysis
        await fileManager.deleteFile(fileName).catch(error => console.warn("Failed to delete remote file:", error));

        const totalAnalyzeTime = (Date.now() - analyzeStart) / 1000;
        console.log(`[Timing] analyzeVideo total: ${formatDuration(totalAnalyzeTime)}`);

        return analysis;
    } catch (error) {
        console.error("Error analyzing video with Gemini:", error);
        throw error;
    }
}

export async function detectObjectInFrame(imagePath: string, objectName: string): Promise<[number, number, number, number] | null> {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `
        This is a photo from a Pet's Point-of-View (POV). 
        Identify the ${objectName} (the friend/visitor) that the pet is interacting with.
        Detect the exact bounding box of THIS specific ${objectName} in the image.
        Output ONLY the bounding box in the format [ymin, xmin, ymax, xmax] using coordinates 0-1000.
        Pick the animal that is the main focus of the interaction.
        Return ONLY the array.
    `;

    try {
        const imageData = {
            inlineData: {
                data: Buffer.from(fs.readFileSync(imagePath)).toString("base64"),
                mimeType: "image/jpeg",
            },
        };

        const result = await withRetry(
            "Gemini detectObjectInFrame",
            () => withTimeout("Gemini detectObjectInFrame", () => model.generateContent([prompt, imageData]), GEMINI_IMAGE_TIMEOUT_MS),
            GEMINI_IMAGE_ATTEMPTS,
            1500
        );
        const responseText = result.response.text();
        const boxMatch = responseText.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);

        if (boxMatch) {
            let ymin = parseInt(boxMatch[1]);
            let xmin = parseInt(boxMatch[2]);
            let ymax = parseInt(boxMatch[3]);
            let xmax = parseInt(boxMatch[4]);

            // Clamp to 0-1000 range
            ymin = Math.max(0, Math.min(1000, ymin));
            xmin = Math.max(0, Math.min(1000, xmin));
            ymax = Math.max(0, Math.min(1000, ymax));
            xmax = Math.max(0, Math.min(1000, xmax));

            // Swap if coordinates are inverted
            if (ymin > ymax) {
                console.warn(`[Box Validation] ymin > ymax (${ymin} > ${ymax}), swapping...`);
                [ymin, ymax] = [ymax, ymin];
            }
            if (xmin > xmax) {
                console.warn(`[Box Validation] xmin > xmax (${xmin} > ${xmax}), swapping...`);
                [xmin, xmax] = [xmax, xmin];
            }

            // Ensure minimum 50x50 size
            if (ymax - ymin < 50 || xmax - xmin < 50) {
                console.warn(`[Box Validation] Box too small (${ymax - ymin}x${xmax - xmin}), expanding...`);
                const yCenterRaw = (ymin + ymax) / 2;
                const xCenterRaw = (xmin + xmax) / 2;
                ymin = Math.max(0, yCenterRaw - 100);
                ymax = Math.min(1000, yCenterRaw + 100);
                xmin = Math.max(0, xCenterRaw - 100);
                xmax = Math.min(1000, xCenterRaw + 100);
            }

            console.log(`[Box Validation] Final validated box: [${ymin}, ${xmin}, ${ymax}, ${xmax}]`);
            return [ymin, xmin, ymax, xmax];
        }
        return null;
    } catch (error) {
        console.error("Error detecting object in frame:", error);
        return null;
    }
}

export async function detectInMosaic(
    mosaicPath: string,
    animalType: string,
    visualTraits: string
): Promise<{ cellIndex: number; box: [number, number, number, number]; confidence: number } | null> {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `
This is a 3x3 grid of 9 video frames (cells numbered 1-9, left-to-right, top-to-bottom).

Find the cell that contains the BEST, clearest view of this specific animal:
- Type: ${animalType}
- Visual traits: ${visualTraits}

Requirements for "best" cell:
- Animal's face/head is visible (not just tail or back)
- Animal is in focus, not blurry
- Animal is clearly distinguishable from background
- If multiple animals are present, select the one matching the visual traits

Return JSON:
{
  "cellIndex": <1-9>,
  "box": [ymin, xmin, ymax, xmax],
  "confidence": <0-100>
}

IMPORTANT - Bounding box rules:
- Coordinates are 0-1000 normalized, RELATIVE TO THE FULL MOSAIC IMAGE.
- The box should be centered on the animal's HEAD/FACE, like a portrait photo.
- Include the head and some upper body/shoulders, but do NOT include the full body or legs.
- Think of it as framing a profile picture: the face should be in the center of the box.

If the animal is not clearly visible in ANY cell, return:
{"cellIndex": null, "box": null, "confidence": 0}
`;

    try {
        const imageData = {
            inlineData: {
                data: Buffer.from(fs.readFileSync(mosaicPath)).toString("base64"),
                mimeType: "image/jpeg",
            },
        };

        const result = await withRetry(
            "Gemini detectInMosaic",
            () => withTimeout("Gemini detectInMosaic", () => model.generateContent([prompt, imageData]), GEMINI_IMAGE_TIMEOUT_MS),
            GEMINI_IMAGE_ATTEMPTS,
            1500
        );
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);

            if (!parsed.cellIndex || !parsed.box || !Array.isArray(parsed.box) || parsed.box.length !== 4) {
                console.log(`[Mosaic Detection] No clear animal found in mosaic for ${animalType} (${visualTraits})`);
                return null;
            }

            const cellIndex = parsed.cellIndex;
            if (cellIndex < 1 || cellIndex > 9) {
                console.warn(`[Mosaic Detection] Invalid cellIndex ${cellIndex}, ignoring`);
                return null;
            }

            // Validate and clamp box coordinates
            let [ymin, xmin, ymax, xmax] = parsed.box.map((v: number) => Math.max(0, Math.min(1000, v)));

            if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
            if (xmin > xmax) [xmin, xmax] = [xmax, xmin];

            // Ensure minimum 50x50 size (on mosaic-level coords)
            if (ymax - ymin < 50 || xmax - xmin < 50) {
                const yCenterRaw = (ymin + ymax) / 2;
                const xCenterRaw = (xmin + xmax) / 2;
                ymin = Math.max(0, yCenterRaw - 100);
                ymax = Math.min(1000, yCenterRaw + 100);
                xmin = Math.max(0, xCenterRaw - 100);
                xmax = Math.min(1000, xCenterRaw + 100);
            }

            const confidence = parsed.confidence || 0;
            console.log(`[Mosaic Detection] Found ${animalType} in cell ${cellIndex} (confidence: ${confidence}%), mosaic box: [${ymin}, ${xmin}, ${ymax}, ${xmax}]`);

            // Convert mosaic-relative coordinates to cell-relative coordinates
            const cellRow = Math.floor((cellIndex - 1) / 3); // 0, 1, 2
            const cellCol = (cellIndex - 1) % 3;             // 0, 1, 2
            const cellSize = 1000 / 3; // ~333.33

            // Transform: mosaic coords → cell coords (both 0-1000 scale)
            ymin = Math.max(0, Math.min(1000, ((ymin - cellRow * cellSize) / cellSize) * 1000));
            xmin = Math.max(0, Math.min(1000, ((xmin - cellCol * cellSize) / cellSize) * 1000));
            ymax = Math.max(0, Math.min(1000, ((ymax - cellRow * cellSize) / cellSize) * 1000));
            xmax = Math.max(0, Math.min(1000, ((xmax - cellCol * cellSize) / cellSize) * 1000));

            // Re-validate minimum size after conversion
            if (ymax - ymin < 50 || xmax - xmin < 50) {
                const yCenterRaw = (ymin + ymax) / 2;
                const xCenterRaw = (xmin + xmax) / 2;
                ymin = Math.max(0, yCenterRaw - 100);
                ymax = Math.min(1000, yCenterRaw + 100);
                xmin = Math.max(0, xCenterRaw - 100);
                xmax = Math.min(1000, xCenterRaw + 100);
            }

            console.log(`[Mosaic Detection] Converted to cell-relative box: [${ymin}, ${xmin}, ${ymax}, ${xmax}]`);

            return {
                cellIndex,
                box: [ymin, xmin, ymax, xmax],
                confidence
            };
        }

        console.log(`[Mosaic Detection] Failed to parse response for ${animalType}`);
        return null;
    } catch (error) {
        console.error(`[Mosaic Detection] Error detecting ${animalType} in mosaic:`, error);
        return null;
    }
}

export async function validateAnimalInFrame(
    imagePath: string,
    animalType: string,
    hintBox?: [number, number, number, number]
): Promise<{ isPresent: boolean; confidence: number; box?: [number, number, number, number] }> {
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    let hintInstruction = '';
    if (hintBox) {
        const [ymin, xmin, ymax, xmax] = hintBox;
        hintInstruction = `
        IMPORTANT: There are multiple animals in this image. Focus on the specific ${animalType} located near the region [ymin=${ymin}, xmin=${xmin}, ymax=${ymax}, xmax=${xmax}] (coordinates 0-1000).
        Return the bounding box for THAT specific animal, not any other animal in the frame.`;
    }

    const prompt = `
        Analyze this image from a pet POV video.
        Is there a ${animalType} clearly visible in this image?
        If yes, also provide its bounding box.
        ${hintInstruction}

        Respond in JSON format:
        {
            "isPresent": true/false,
            "confidence": 0-100,
            "reason": "brief explanation",
            "box": [ymin, xmin, ymax, xmax]
        }

        Rules:
        - isPresent: true only if the ${animalType} is clearly visible (face, body, or distinctive features)
        - confidence: 0-100 score of how certain you are. Give HIGHER confidence (80+) when the animal's face/head is clearly visible. Give LOWER confidence (below 50) when only tail, legs, or back is visible without the head.
        - box: bounding box coordinates in 0-1000 range [ymin, xmin, ymax, xmax]. Only include if isPresent is true.
        - If the image shows only ground, grass, sky, or walls without any animal, return isPresent: false and omit box
    `;

    try {
        const imageData = {
            inlineData: {
                data: Buffer.from(fs.readFileSync(imagePath)).toString("base64"),
                mimeType: "image/jpeg",
            },
        };

        const result = await withRetry(
            "Gemini validateAnimalInFrame",
            () => withTimeout("Gemini validateAnimalInFrame", () => model.generateContent([prompt, imageData]), GEMINI_IMAGE_TIMEOUT_MS),
            GEMINI_IMAGE_ATTEMPTS,
            1500
        );
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log(`[Validation] ${animalType} in ${path.basename(imagePath)}: ${parsed.isPresent ? 'YES' : 'NO'} (${parsed.confidence}%) - ${parsed.reason}`);

            let validatedBox: [number, number, number, number] | undefined;
            if (parsed.isPresent && parsed.box && Array.isArray(parsed.box) && parsed.box.length === 4) {
                let [ymin, xmin, ymax, xmax] = parsed.box.map((v: number) => Math.max(0, Math.min(1000, v)));

                // Swap if coordinates are inverted
                if (ymin > ymax) {
                    console.warn(`[Box Validation] ymin > ymax (${ymin} > ${ymax}), swapping...`);
                    [ymin, ymax] = [ymax, ymin];
                }
                if (xmin > xmax) {
                    console.warn(`[Box Validation] xmin > xmax (${xmin} > ${xmax}), swapping...`);
                    [xmin, xmax] = [xmax, xmin];
                }

                // Ensure minimum 50x50 size
                if (ymax - ymin < 50 || xmax - xmin < 50) {
                    console.warn(`[Box Validation] Box too small (${ymax - ymin}x${xmax - xmin}), expanding...`);
                    const yCenterRaw = (ymin + ymax) / 2;
                    const xCenterRaw = (xmin + xmax) / 2;
                    ymin = Math.max(0, yCenterRaw - 100);
                    ymax = Math.min(1000, yCenterRaw + 100);
                    xmin = Math.max(0, xCenterRaw - 100);
                    xmax = Math.min(1000, xCenterRaw + 100);
                }

                validatedBox = [ymin, xmin, ymax, xmax];
                console.log(`[Validation] Box for ${animalType}: [${validatedBox}]`);
            }

            return {
                isPresent: parsed.isPresent === true,
                confidence: parsed.confidence || 0,
                box: validatedBox
            };
        }
        return { isPresent: false, confidence: 0 };
    } catch (error) {
        console.error("Error validating animal in frame:", error);
        return { isPresent: false, confidence: 0 };
    }
}
