import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import { Firestore } from '@google-cloud/firestore';
import { analyzeVideo, detectInMosaic } from './processor/videoAnalyzer.ts';
import { generateHighlights } from './processor/highlightGenerator.ts';
import { createProxyVideo, extractFrame, extractAndCropFrame, extractMosaicFrames, createMosaic, cropImageWithBox, getVideoDuration } from './processor/videoPreprocessor.ts';
import { config } from './config.ts';

// Performance timing utilities
interface StageTime {
    stage: string;
    duration: number; // seconds
    startedAt: number;
    completedAt: number;
}

function formatDuration(seconds: number): string {
    if (seconds >= 60) {
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m}m ${s}s`;
    }
    return `${seconds.toFixed(1)}s`;
}

const app = express();
const port = Number(process.env.PORT || 3001);

function readPositiveIntEnv(name: string, fallback: number): number {
    const raw = Number(process.env[name] || '');
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.floor(raw);
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const storageBucketName = process.env.STORAGE_BUCKET || '';
const sampleAssetPrefix = process.env.SAMPLE_ASSET_PREFIX || 'samples';
const sampleCollectionName = process.env.SAMPLE_COLLECTION || 'sample_sessions';
const sessionCollectionName = process.env.SESSION_COLLECTION || 'sessions';
const uploadObjectPrefix = process.env.UPLOAD_OBJECT_PREFIX || 'uploads/original';
const generatedObjectPrefix = process.env.GENERATED_OBJECT_PREFIX || 'uploads/generated';
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || `${20 * 1024 * 1024 * 1024}`); // 20GB default
const resumableChunkBytes = Number(process.env.RESUMABLE_CHUNK_BYTES || `${8 * 1024 * 1024}`); // 8MB default
const friendProcessingConcurrency = readPositiveIntEnv('FRIEND_PROCESSING_CONCURRENCY', 3);

type SampleTarget = {
    sampleId: string;
    originalName: string;
    petName: string;
};

const SAMPLE_VIDEO_TARGETS: SampleTarget[] = [
    { sampleId: 'sample-jackson', originalName: 'CAT1.mp4', petName: 'Jackson' },
    { sampleId: 'sample-luna', originalName: 'Cat2.mp4', petName: 'Luna' }
];

const exampleVideosPrefix = process.env.EXAMPLE_VIDEOS_PREFIX || 'examples';

type ExampleVideo = {
    id: string;
    fileName: string;
    label: string;
    petType: 'cat' | 'dog';
    suggestedPetName: string;
    fileSizeMB: number;
};

const EXAMPLE_VIDEOS: ExampleVideo[] = [
    { id: 'cat1', fileName: 'CAT1.mp4', label: 'Cat Indoor Play', petType: 'cat', suggestedPetName: 'Whiskers', fileSizeMB: 110 },
    { id: 'cat2', fileName: 'Cat2.mp4', label: 'Cat Window Watching', petType: 'cat', suggestedPetName: 'Luna', fileSizeMB: 111 },
    { id: 'cat3', fileName: 'Cat3.mp4', label: 'Cat Garden Exploring', petType: 'cat', suggestedPetName: 'Mochi', fileSizeMB: 102 },
    { id: 'cat4', fileName: 'Cat4.mp4', label: 'Cat Outdoor Adventure', petType: 'cat', suggestedPetName: 'Shadow', fileSizeMB: 354 },
    { id: 'dog2', fileName: 'Dog2.mp4', label: 'Dog Park Walk', petType: 'dog', suggestedPetName: 'Buddy', fileSizeMB: 221 },
    { id: 'dog3', fileName: 'Dog3.mp4', label: 'Dog Backyard Fun', petType: 'dog', suggestedPetName: 'Cooper', fileSizeMB: 87 },
    { id: 'dog5', fileName: 'Dog5.mp4', label: 'Dog Neighborhood Stroll', petType: 'dog', suggestedPetName: 'Max', fileSizeMB: 182 },
];

app.use(cors());
app.use(express.json());

// Serve static files from the uploads directory
app.use('/uploads', express.static(config.uploadDir));

// Set up multer for video uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(config.uploadDir)) {
            fs.mkdirSync(config.uploadDir, { recursive: true });
        }
        cb(null, config.uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage });

// Store session results in memory and persist to file
const sessionsPath = path.resolve(config.outputDir, 'sessions.json');
const sampleSessionsPath = path.resolve(process.cwd(), 'samples', 'sessions.json');
let sessions: Record<string, any> = {};
let sampleSessions: any[] = [];
let storageClient: Storage | null = null;
let firestoreClient: Firestore | null = null;

function ensureDirExists(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

async function runWithConcurrencyLimit<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>
) {
    const limit = Math.max(1, Math.min(concurrency, items.length || 1));
    let cursor = 0;
    const runners = Array.from({ length: limit }, async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) break;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
}

if (storageBucketName) {
    try {
        storageClient = new Storage();
    } catch (e) {
        console.error('Failed to initialize Google Cloud Storage client:', e);
    }
}

try {
    firestoreClient = new Firestore({
        ignoreUndefinedProperties: true,
    });
} catch (e) {
    console.error('Failed to initialize Firestore client:', e);
}

if (fs.existsSync(sessionsPath)) {
    try {
        sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
        // Session Migration: Map timestamps for any existing ready sessions
        setTimeout(() => migrateSessions(), 100);
    } catch (e) {
        console.error('Failed to load sessions.json:', e);
    }
}

if (fs.existsSync(sampleSessionsPath)) {
    try {
        sampleSessions = JSON.parse(fs.readFileSync(sampleSessionsPath, 'utf8'));
    } catch (e) {
        console.error('Failed to load sample sessions:', e);
        sampleSessions = [];
    }
}

ensureDirExists(config.outputDir);
ensureDirExists(config.uploadDir);
setTimeout(() => {
    void loadSessionsFromFirestore();
    void getAllSampleSessions();
}, 200);

function saveSessions() {
    ensureDirExists(config.outputDir);
    fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
}

function sanitizeForFirestore(obj: any): any {
    if (obj === null || obj === undefined) return null;
    if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
    if (typeof obj === 'object') {
        const cleaned: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
                cleaned[key] = sanitizeForFirestore(value);
            }
        }
        return cleaned;
    }
    return obj;
}

async function upsertSessionToFirestore(sessionId: string) {
    if (!firestoreClient) return;
    const session = sessions[sessionId];
    if (!session) return;
    try {
        const sanitized = sanitizeForFirestore(session);
        await firestoreClient.collection(sessionCollectionName).doc(sessionId).set(sanitized, { merge: true });
    } catch (error) {
        console.error(`Failed to sync session ${sessionId} to Firestore:`, error);
        // If a ready session failed to persist, write error status so frontend doesn't spin forever
        if (session.status === 'ready') {
            try {
                await firestoreClient.collection(sessionCollectionName).doc(sessionId).set({
                    status: 'error',
                    error: `Firestore sync failed: ${(error as Error).message}`,
                    completedAt: Date.now()
                }, { merge: true });
            } catch (retryError) {
                console.error(`Failed to write error status for ${sessionId}:`, retryError);
            }
        }
    }
}

function persistSession(sessionId: string): Promise<void> {
    saveSessions();
    return upsertSessionToFirestore(sessionId);
}

async function getSessionFromFirestore(sessionId: string) {
    if (!firestoreClient) return null;
    try {
        const doc = await firestoreClient.collection(sessionCollectionName).doc(sessionId).get();
        if (!doc.exists) return null;
        return doc.data();
    } catch (error) {
        console.error(`Failed to read session ${sessionId} from Firestore:`, error);
        return null;
    }
}

async function loadSessionsFromFirestore() {
    if (!firestoreClient) return;
    try {
        const snap = await firestoreClient.collection(sessionCollectionName).get();
        const remoteEntries = snap.docs.map((doc) => doc.data()).filter((item) => item?.id);
        if (remoteEntries.length === 0) return;

        const merged: Record<string, any> = { ...sessions };
        for (const item of remoteEntries) {
            merged[item.id] = item;
        }
        sessions = merged;
        // Auto-fix sessions stuck in "processing" that actually completed
        let fixedCount = 0;
        for (const id in sessions) {
            const s = sessions[id];
            if (s.status === 'processing' && s.analysis && s.completedAt) {
                s.status = 'ready';
                fixedCount++;
                void upsertSessionToFirestore(id);
            }
        }
        if (fixedCount > 0) {
            console.log(`[Session Sync] Auto-fixed ${fixedCount} stuck session(s) to ready.`);
        }
        saveSessions();
        console.log(`[Session Sync] Loaded ${remoteEntries.length} session(s) from Firestore.`);
    } catch (error) {
        console.error('Failed to load sessions from Firestore:', error);
    }
}

function saveSampleSessions() {
    const dir = path.dirname(sampleSessionsPath);
    ensureDirExists(dir);
    fs.writeFileSync(sampleSessionsPath, JSON.stringify(sampleSessions, null, 2));
}

function normalizeName(value: string | null | undefined) {
    return String(value || '').trim().toLowerCase();
}

function sanitizeFileStem(value: string, fallback = 'video') {
    const stem = path.basename(value || '', path.extname(value || ''))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return stem || fallback;
}

function sanitizeObjectPathPart(value: string, fallback = 'video') {
    const safe = String(value || '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
    return safe || fallback;
}

function getSafeExtension(filename: string) {
    const ext = path.extname(filename || '').toLowerCase();
    if (!ext || ext.length > 10 || /[^a-z0-9.]/i.test(ext)) {
        return '.mp4';
    }
    return ext;
}

function getSessionOriginalAssetUrl(sessionId: string) {
    return `${publicBaseUrl}/api/session-asset/${encodeURIComponent(sessionId)}/original`;
}

function getSessionHighlightAssetUrl(sessionId: string) {
    return `${publicBaseUrl}/api/session-asset/${encodeURIComponent(sessionId)}/highlight`;
}

function getSessionCoverAssetUrl(sessionId: string) {
    return `${publicBaseUrl}/api/session-asset/${encodeURIComponent(sessionId)}/cover`;
}

function getSessionFrameAssetUrl(sessionId: string, objectPath: string): string {
    const filename = path.basename(objectPath);
    return `${publicBaseUrl}/api/session-asset/${encodeURIComponent(sessionId)}/frame/${encodeURIComponent(filename)}`;
}

function getMimeTypeForPath(filePath: string) {
    const ext = path.extname(filePath || '').toLowerCase();
    switch (ext) {
        case '.mp4':
            return 'video/mp4';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
}

function buildGeneratedObjectPath(sessionId: string, kind: 'highlight' | 'cover', sourcePath: string) {
    const safeSession = sanitizeObjectPathPart(sessionId, 'session');
    const ext = getSafeExtension(path.basename(sourcePath || 'asset.mp4'));
    const safeName = sanitizeObjectPathPart(`${kind}${ext}`, `${kind}.mp4`);
    return `${generatedObjectPrefix}/${safeSession}/${safeName}`;
}

async function uploadGeneratedAsset(sessionId: string, kind: 'highlight' | 'cover', sourcePath: string) {
    if (!storageClient || !storageBucketName) return null;
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;

    const objectPath = buildGeneratedObjectPath(sessionId, kind, sourcePath);
    await storageClient.bucket(storageBucketName).upload(sourcePath, {
        destination: objectPath,
        metadata: {
            contentType: getMimeTypeForPath(sourcePath),
            cacheControl: 'public,max-age=31536000,immutable'
        }
    });
    return objectPath;
}

async function uploadFrameAsset(
    sessionId: string,
    category: string,
    sourcePath: string
): Promise<string | null> {
    if (!storageClient || !storageBucketName) return null;
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;

    const safeSession = sanitizeObjectPathPart(sessionId, 'session');
    const safeName = sanitizeObjectPathPart(path.basename(sourcePath), 'frame.jpg');
    const objectPath = `${generatedObjectPrefix}/${safeSession}/frames/${category}-${safeName}`;

    await storageClient.bucket(storageBucketName).upload(sourcePath, {
        destination: objectPath,
        metadata: {
            contentType: getMimeTypeForPath(sourcePath),
            cacheControl: 'public,max-age=31536000,immutable'
        }
    });
    return objectPath;
}

function resolveSampleTarget(session: any): SampleTarget | null {
    const originalName = normalizeName(session?.originalName);
    const petName = normalizeName(session?.petName);
    return SAMPLE_VIDEO_TARGETS.find((target) =>
        normalizeName(target.originalName) === originalName &&
        normalizeName(target.petName) === petName
    ) || null;
}

function sampleAssetObjectPath(sampleId: string, filename: string) {
    return `${sampleAssetPrefix}/${sampleId}/${filename}`;
}

function sampleAssetUrl(sampleId: string, filename: string) {
    return `${publicBaseUrl}/api/sample-asset/${encodeURIComponent(sampleId)}/${encodeURIComponent(filename)}`;
}

function extractUploadBasename(value: string | null | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    let pathname = value;
    if (/^https?:\/\//i.test(value)) {
        try {
            pathname = new URL(value).pathname;
        } catch {
            pathname = value;
        }
    }
    const marker = '/uploads/';
    const idx = pathname.indexOf(marker);
    if (idx === -1) return null;
    const filePart = pathname.slice(idx + marker.length).split('?')[0];
    const base = path.basename(filePart);
    return base || null;
}

function collectSessionAssets(session: any): Map<string, string> {
    const assetMap = new Map<string, string>();

    const addLocalPath = (filePath: string | null | undefined) => {
        if (!filePath || typeof filePath !== 'string') return;
        if (!path.isAbsolute(filePath)) return;
        if (!fs.existsSync(filePath)) return;
        assetMap.set(path.basename(filePath), filePath);
    };

    const addFromUploadUrl = (value: string | null | undefined) => {
        const base = extractUploadBasename(value);
        if (!base) return;
        const localPath = path.join(config.uploadDir, base);
        if (fs.existsSync(localPath)) {
            assetMap.set(base, localPath);
        }
    };

    addLocalPath(session?.path);
    addLocalPath(session?.highlightPath);
    addLocalPath(session?.coverPath);
    addFromUploadUrl(session?.videoUrl);
    addFromUploadUrl(session?.highlightUrl);
    addFromUploadUrl(session?.coverUrl);

    const walk = (node: any, keyHint = '') => {
        if (Array.isArray(node)) {
            node.forEach((item) => walk(item, keyHint));
            return;
        }
        if (!node || typeof node !== 'object') return;

        Object.entries(node).forEach(([key, value]) => {
            if (typeof value === 'string') {
                if (key === 'url' || key.endsWith('Url')) addFromUploadUrl(value);
                if (key.endsWith('Path')) addLocalPath(value);
            } else if (typeof value === 'object' && value !== null) {
                walk(value, key);
            }
        });
    };

    walk(session?.analysis);
    return assetMap;
}

function rewriteSessionForSample(session: any, sampleId: string) {
    const rewriteString = (key: string, value: string) => {
        const uploadBase = extractUploadBasename(value);
        if (uploadBase) {
            return sampleAssetUrl(sampleId, uploadBase);
        }
        if (key.endsWith('Path') && path.isAbsolute(value)) {
            return sampleAssetUrl(sampleId, path.basename(value));
        }
        return value;
    };

    const walk = (node: any): any => {
        if (Array.isArray(node)) return node.map(walk);
        if (!node || typeof node !== 'object') return node;

        const out: Record<string, any> = {};
        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string') {
                out[key] = rewriteString(key, value);
            } else {
                out[key] = walk(value);
            }
        }
        return out;
    };

    const cloned = walk(session);
    cloned.id = sampleId;
    cloned.status = 'ready';
    cloned.isSample = true;
    cloned.sampleKey = sampleId;
    cloned.sourceSessionId = session.id;
    cloned.updatedAt = new Date().toISOString();
    return cloned;
}

async function uploadSampleAssets(sampleId: string, assets: Map<string, string>) {
    if (!storageClient || !storageBucketName) {
        throw new Error('Cloud Storage is not configured (STORAGE_BUCKET missing).');
    }
    const bucket = storageClient.bucket(storageBucketName);

    for (const [filename, localPath] of assets.entries()) {
        const destination = sampleAssetObjectPath(sampleId, filename);
        await bucket.upload(localPath, {
            destination,
            metadata: {
                cacheControl: 'public,max-age=31536000,immutable'
            }
        });
    }
}

async function upsertSampleSession(sampleSession: any) {
    if (firestoreClient) {
        await firestoreClient.collection(sampleCollectionName).doc(sampleSession.id).set(sampleSession, { merge: true });
    }

    const idx = sampleSessions.findIndex((s) => s.id === sampleSession.id);
    if (idx >= 0) sampleSessions[idx] = sampleSession;
    else sampleSessions.push(sampleSession);
    saveSampleSessions();
}

async function getSampleSessionById(id: string) {
    if (firestoreClient) {
        try {
            const doc = await firestoreClient.collection(sampleCollectionName).doc(id).get();
            if (doc.exists) {
                return doc.data();
            }
        } catch (e) {
            console.error('Failed reading sample session from Firestore:', e);
        }
    }
    return sampleSessions.find((s) => s.id === id);
}

async function getAllSampleSessions() {
    if (firestoreClient) {
        try {
            const snap = await firestoreClient.collection(sampleCollectionName).get();
            const remote = snap.docs.map((doc) => doc.data());
            if (remote.length > 0 || sampleSessions.length === 0) {
                sampleSessions = remote;
                saveSampleSessions();
            }
            return sampleSessions;
        } catch (e) {
            console.error('Failed reading sample sessions from Firestore:', e);
        }
    }
    return sampleSessions;
}

async function promoteSessionToSample(session: any, target: SampleTarget) {
    if (!session || session.status !== 'ready') {
        throw new Error('Session is not ready for sample promotion.');
    }

    const assets = collectSessionAssets(session);
    if (assets.size === 0) {
        throw new Error('No local media assets found to publish as sample.');
    }

    await uploadSampleAssets(target.sampleId, assets);

    const promoted = rewriteSessionForSample(session, target.sampleId);
    promoted.originalName = target.originalName;
    promoted.petName = target.petName;
    promoted.path = promoted.videoUrl;
    promoted.highlightPath = promoted.highlightUrl;

    await upsertSampleSession(promoted);
}

function buildUploadObjectPath(sessionId: string, originalName: string) {
    const extension = getSafeExtension(originalName);
    const safeName = sanitizeObjectPathPart(`${sessionId}${extension}`, `${sessionId}.mp4`);
    return `${uploadObjectPrefix}/${safeName}`;
}

function buildLocalProcessingInputPath(sessionId: string, originalName?: string) {
    const extension = getSafeExtension(originalName || `${sessionId}.mp4`);
    const safeSession = sanitizeFileStem(sessionId, 'session');
    return path.join(config.uploadDir, `${safeSession}-source${extension}`);
}

async function resolveProcessingVideoInput(
    sessionId: string,
    localPathFromUpload?: string
): Promise<{ inputPath: string; publicVideoUrl: string | null; cleanupPaths: string[] }> {
    if (localPathFromUpload) {
        return {
            inputPath: localPathFromUpload,
            publicVideoUrl: getFileUrl(localPathFromUpload),
            cleanupPaths: []
        };
    }

    const session = sessions[sessionId];
    if (!session) {
        throw new Error(`Session ${sessionId} not found`);
    }

    if (session.objectPath) {
        if (!storageClient || !storageBucketName) {
            throw new Error('Cloud Storage is not configured (STORAGE_BUCKET missing).');
        }
        const file = storageClient.bucket(storageBucketName).file(session.objectPath);
        const [exists] = await file.exists();
        if (!exists) {
            throw new Error(`Cloud object not found for session ${sessionId}`);
        }

        const localInputPath = buildLocalProcessingInputPath(sessionId, session.originalName);
        await file.download({ destination: localInputPath });

        return {
            inputPath: localInputPath,
            publicVideoUrl: getSessionOriginalAssetUrl(sessionId),
            cleanupPaths: [localInputPath]
        };
    }

    if (session.path && typeof session.path === 'string') {
        return {
            inputPath: session.path,
            publicVideoUrl: getFileUrl(session.path),
            cleanupPaths: []
        };
    }

    throw new Error(`No video source found for session ${sessionId}`);
}

app.post('/api/uploads/resumable', async (req, res) => {
    if (!storageClient || !storageBucketName) {
        return res.status(500).json({ error: 'Cloud Storage is not configured on the server.' });
    }

    const originalName = String(req.body?.fileName || '').trim();
    const mimeType = String(req.body?.fileType || 'application/octet-stream').trim() || 'application/octet-stream';
    const fileSize = Number(req.body?.fileSize || 0);
    const petName = String(req.body?.petName || '').trim();
    const visitorId = String(req.body?.visitorId || '').trim();

    if (!originalName) {
        return res.status(400).json({ error: 'fileName is required' });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
        return res.status(400).json({ error: 'fileSize must be a positive number' });
    }
    if (fileSize > maxUploadBytes) {
        return res.status(413).json({
            error: `File too large. Max upload size is ${Math.floor(maxUploadBytes / (1024 * 1024 * 1024))}GB.`
        });
    }

    const now = Date.now();
    const sessionStem = sanitizeFileStem(originalName);
    const sessionId = `${now}-${sessionStem}`;
    const objectPath = buildUploadObjectPath(sessionId, originalName);
    const requestOrigin = String(req.headers.origin || publicBaseUrl);

    sessions[sessionId] = {
        id: sessionId,
        status: 'uploading',
        originalName,
        petName,
        visitorId: visitorId || undefined,
        path: objectPath,
        objectPath,
        storageBucket: storageBucketName,
        mimeType,
        fileSize,
        createdAt: new Date().toISOString()
    };
    persistSession(sessionId);

    try {
        const bucket = storageClient.bucket(storageBucketName);
        const file = bucket.file(objectPath);
        const [uploadUrl] = await file.createResumableUpload({
            origin: requestOrigin,
            metadata: {
                contentType: mimeType,
                metadata: {
                    sessionId,
                    petName,
                    originalName
                }
            }
        });

        res.json({
            sessionId,
            uploadUrl,
            chunkSize: resumableChunkBytes,
            maxUploadBytes
        });
    } catch (error) {
        sessions[sessionId].status = 'error';
        sessions[sessionId].error = `Failed to initialize resumable upload: ${(error as Error).message}`;
        sessions[sessionId].completedAt = Date.now();
        persistSession(sessionId);
        res.status(500).json({ error: 'Failed to initialize resumable upload.' });
    }
});

app.post('/api/uploads/complete', async (req, res) => {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    let session = sessions[sessionId];
    if (!session) {
        const remote = await getSessionFromFirestore(sessionId);
        if (remote) {
            sessions[sessionId] = remote;
            session = remote;
            saveSessions();
        }
    }
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'processing' || session.status === 'ready') {
        return res.json({ sessionId, status: session.status });
    }

    if (!session.objectPath) {
        return res.status(400).json({ error: 'Session does not have a cloud object path' });
    }

    if (!storageClient || !storageBucketName) {
        return res.status(500).json({ error: 'Cloud Storage is not configured on the server.' });
    }

    try {
        const file = storageClient.bucket(storageBucketName).file(session.objectPath);
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(400).json({ error: 'Upload is not complete yet' });
        }

        const [metadata] = await file.getMetadata();
        session.fileSize = Number(metadata.size || session.fileSize || 0);
        session.mimeType = metadata.contentType || session.mimeType || 'application/octet-stream';
        session.status = 'processing';
        session.startedAt = Date.now();
        persistSession(sessionId);

        processVideo(sessionId).catch(console.error);
        res.json({ sessionId, status: 'processing' });
    } catch (error) {
        session.status = 'error';
        session.error = `Failed to finalize upload: ${(error as Error).message}`;
        session.completedAt = Date.now();
        persistSession(sessionId);
        res.status(500).json({ error: 'Failed to finalize upload.' });
    }
});

// ---------- Example Videos ----------

app.get('/api/example-videos', (_req, res) => {
    res.json(EXAMPLE_VIDEOS);
});

app.post('/api/uploads/from-example', async (req, res) => {
    const exampleId = String(req.body?.exampleId || '').trim();
    const petName = String(req.body?.petName || '').trim();
    const visitorId = String(req.body?.visitorId || '').trim();

    const example = EXAMPLE_VIDEOS.find(v => v.id === exampleId);
    if (!example) {
        return res.status(400).json({ error: 'Invalid exampleId' });
    }

    if (!storageClient || !storageBucketName) {
        return res.status(500).json({ error: 'Cloud Storage is not configured on the server.' });
    }

    const now = Date.now();
    const sessionStem = sanitizeFileStem(example.fileName);
    const sessionId = `${now}-${sessionStem}`;
    const objectPath = buildUploadObjectPath(sessionId, example.fileName);

    sessions[sessionId] = {
        id: sessionId,
        status: 'processing',
        originalName: example.fileName,
        petName: petName || example.suggestedPetName,
        visitorId: visitorId || undefined,
        path: objectPath,
        objectPath,
        storageBucket: storageBucketName,
        mimeType: 'video/mp4',
        fileSize: example.fileSizeMB * 1024 * 1024,
        createdAt: new Date().toISOString(),
        startedAt: now,
    };
    persistSession(sessionId);

    // Copy within same bucket (fast server-side copy)
    const srcPath = `${exampleVideosPrefix}/${example.fileName}`;
    try {
        const bucket = storageClient.bucket(storageBucketName);
        await bucket.file(srcPath).copy(bucket.file(objectPath));
    } catch (error) {
        sessions[sessionId].status = 'error';
        sessions[sessionId].error = `Failed to copy example video: ${(error as Error).message}`;
        sessions[sessionId].completedAt = Date.now();
        persistSession(sessionId);
        return res.status(500).json({ error: 'Failed to prepare example video.' });
    }

    res.json({ sessionId, status: 'processing' });
    processVideo(sessionId).catch(console.error);
});

app.post('/api/upload', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video uploaded' });
    }

    const sessionId = path.basename(req.file.path, path.extname(req.file.path));
    const petName = req.body?.petName || '';
    sessions[sessionId] = {
        id: sessionId,
        status: 'processing',
        originalName: req.file.originalname,
        path: req.file.path,
        petName: petName,
        createdAt: new Date().toISOString(),
        startedAt: Date.now()
    };
    persistSession(sessionId);

    // Start processing asynchronously
    processVideo(sessionId, req.file.path).catch(console.error);

    res.json({ sessionId });
});

// Helper to convert local path to URL
function getFileUrl(filePath: string) {
    if (!filePath) return null;
    return `${publicBaseUrl}/uploads/${path.basename(filePath)}`;
}

function getPublicUrl(urlOrPath: string | null | undefined) {
    if (!urlOrPath) return null;
    if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
    if (urlOrPath.startsWith('/')) return `${publicBaseUrl}${urlOrPath}`;
    return urlOrPath;
}

function buildSessionResponse(session: any) {
    const isCloudSession = Boolean(session.objectPath);
    const videoUrl = isCloudSession
        ? getSessionOriginalAssetUrl(session.id)
        : getPublicUrl(session.videoUrl) || getFileUrl(session.path);
    const highlightUrl = session.highlightObjectPath
        ? getSessionHighlightAssetUrl(session.id)
        : (isCloudSession ? null : (getPublicUrl(session.highlightUrl) || getFileUrl(session.highlightPath)));
    const coverUrl = session.coverObjectPath
        ? getSessionCoverAssetUrl(session.id)
        : (isCloudSession ? null : getPublicUrl(session.coverUrl));

    // Normalize analysis frame URLs for cloud sessions:
    // - imageObjectPath present → use GCS-backed API endpoint
    // - /uploads/ URL on cloud session → null (dead link)
    // - other URL → keep as-is
    const analysis = session.analysis ? { ...session.analysis } : undefined;
    if (analysis && isCloudSession) {
        const normalizeFrameUrl = (item: any) => {
            if (item.imageObjectPath) {
                return getSessionFrameAssetUrl(session.id, item.imageObjectPath);
            }
            if (item.url && !item.url.includes('/uploads/')) {
                return item.url;
            }
            return null;
        };
        if (analysis.friends) {
            analysis.friends = analysis.friends.map((f: any) => ({ ...f, url: normalizeFrameUrl(f) }));
        }
        if (analysis.scenery) {
            analysis.scenery = analysis.scenery.map((s: any) => ({ ...s, url: normalizeFrameUrl(s) }));
        }
        if (analysis.dietaryHabits) {
            analysis.dietaryHabits = analysis.dietaryHabits.map((d: any) => ({ ...d, url: normalizeFrameUrl(d) }));
        }
    }

    return {
        ...session,
        analysis,
        videoUrl,
        highlightUrl,
        coverUrl
    };
}

async function redirectToSignedUrl(
    objectPath: string,
    res: express.Response,
    notFoundMessage: string,
    failureMessage: string
) {
    if (!storageClient || !storageBucketName) {
        return res.status(404).json({ error: 'Cloud Storage is not configured' });
    }
    const file = storageClient.bucket(storageBucketName).file(objectPath);
    try {
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).json({ error: notFoundMessage });
        }
        const [signedUrl] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 30 * 60 * 1000, // 30 minutes
        });
        return res.redirect(302, signedUrl);
    } catch (error) {
        console.error(failureMessage, error);
        return res.status(500).json({ error: failureMessage });
    }
}

async function streamSessionStorageObject(
    req: express.Request,
    objectPath: string,
    res: express.Response,
    notFoundMessage: string,
    failureMessage: string
) {
    if (!storageClient || !storageBucketName) {
        return res.status(404).json({ error: 'Cloud Storage is not configured' });
    }
    const file = storageClient.bucket(storageBucketName).file(objectPath);
    try {
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).json({ error: notFoundMessage });
        }
        const [metadata] = await file.getMetadata();
        const fileSize = Number(metadata.size);
        const contentType = metadata.contentType || 'application/octet-stream';

        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', metadata.cacheControl || 'public,max-age=3600');

        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize || start > end) {
                res.setHeader('Content-Range', `bytes */${fileSize}`);
                return res.status(416).end();
            }

            const chunkSize = end - start + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunkSize,
                'Content-Type': contentType,
            });

            file.createReadStream({ start, end })
                .on('error', (error) => {
                    console.error(failureMessage, error);
                    if (!res.headersSent) res.status(500).json({ error: failureMessage });
                })
                .pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
            });

            file.createReadStream()
                .on('error', (error) => {
                    console.error(failureMessage, error);
                    if (!res.headersSent) res.status(500).json({ error: failureMessage });
                })
                .pipe(res);
        }
        return;
    } catch (error) {
        console.error(failureMessage, error);
        return res.status(500).json({ error: failureMessage });
    }
}

app.get('/api/session-asset/:id/original', async (req, res) => {
    let session = sessions[req.params.id];
    if (!session) {
        session = await getSessionFromFirestore(req.params.id);
        if (session) {
            sessions[req.params.id] = session;
            saveSessions();
        }
    }
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.objectPath) {
        return redirectToSignedUrl(
            session.objectPath,
            res,
            'Original asset not found',
            'Failed to read original asset'
        );
    }

    if (session.path && typeof session.path === 'string' && fs.existsSync(session.path)) {
        return res.sendFile(path.resolve(session.path));
    }

    return res.status(404).json({ error: 'Original asset not found' });
});

app.get('/api/session-asset/:id/highlight', async (req, res) => {
    let session = sessions[req.params.id];
    if (!session) {
        session = await getSessionFromFirestore(req.params.id);
        if (session) {
            sessions[req.params.id] = session;
            saveSessions();
        }
    }
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.highlightObjectPath) {
        return redirectToSignedUrl(
            session.highlightObjectPath,
            res,
            'Highlight asset not found',
            'Failed to read highlight asset'
        );
    }

    // Fallback: try default GCS path when highlightObjectPath is missing but file may exist
    if (!session.highlightObjectPath && storageClient && storageBucketName) {
        const fallbackPath = `${generatedObjectPrefix}/${req.params.id}/highlight.mp4`;
        try {
            const [exists] = await storageClient.bucket(storageBucketName).file(fallbackPath).exists();
            if (exists) {
                session.highlightObjectPath = fallbackPath;
                persistSession(req.params.id);
                return redirectToSignedUrl(
                    fallbackPath,
                    res,
                    'Highlight asset not found',
                    'Failed to read highlight asset'
                );
            }
        } catch (e) {
            // ignore fallback check failure
        }
    }

    if (session.highlightPath && typeof session.highlightPath === 'string' && fs.existsSync(session.highlightPath)) {
        return res.sendFile(path.resolve(session.highlightPath));
    }

    return res.status(404).json({ error: 'Highlight asset not found' });
});

app.get('/api/session-asset/:id/cover', async (req, res) => {
    let session = sessions[req.params.id];
    if (!session) {
        session = await getSessionFromFirestore(req.params.id);
        if (session) {
            sessions[req.params.id] = session;
            saveSessions();
        }
    }
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.coverObjectPath) {
        return streamSessionStorageObject(
            req,
            session.coverObjectPath,
            res,
            'Cover asset not found',
            'Failed to read cover asset'
        );
    }

    if (session.coverPath && typeof session.coverPath === 'string' && fs.existsSync(session.coverPath)) {
        return res.sendFile(path.resolve(session.coverPath));
    }

    const coverBasename = extractUploadBasename(session.coverUrl);
    if (coverBasename) {
        const fallbackPath = path.join(config.uploadDir, coverBasename);
        if (fs.existsSync(fallbackPath)) {
            return res.sendFile(path.resolve(fallbackPath));
        }
    }

    return res.status(404).json({ error: 'Cover asset not found' });
});

app.get('/api/session-asset/:id/frame/:filename', async (req, res) => {
    let session = sessions[req.params.id];
    if (!session) {
        session = await getSessionFromFirestore(req.params.id);
        if (session) {
            sessions[req.params.id] = session;
            saveSessions();
        }
    }
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const safeSession = sanitizeObjectPathPart(req.params.id, 'session');
    const safeFilename = sanitizeObjectPathPart(
        decodeURIComponent(req.params.filename), 'frame.jpg'
    );
    const objectPath = `${generatedObjectPrefix}/${safeSession}/frames/${safeFilename}`;

    return streamSessionStorageObject(
        req, objectPath, res,
        'Frame asset not found',
        'Failed to read frame asset'
    );
});

app.get('/api/sample-asset/:sampleId/:filename', async (req, res) => {
    if (!storageClient || !storageBucketName) {
        return res.status(404).json({ error: 'Sample storage is not configured' });
    }

    const sampleId = req.params.sampleId;
    const filename = req.params.filename;
    const objectPath = sampleAssetObjectPath(sampleId, filename);

    // Use signed URL redirect for video files (avoids Firebase 32MB proxy limit)
    if (filename.endsWith('.mp4') || filename.endsWith('.webm') || filename.endsWith('.mov')) {
        return redirectToSignedUrl(
            objectPath, res,
            'Sample asset not found',
            'Failed to read sample asset'
        );
    }

    // Stream small files (images) directly
    return streamSessionStorageObject(
        req, objectPath, res,
        'Sample asset not found',
        'Failed to read sample asset'
    );
});

app.get('/api/session/:id', async (req, res) => {
    let session = sessions[req.params.id];
    if (!session) {
        session = await getSessionFromFirestore(req.params.id);
        if (session) {
            sessions[req.params.id] = session;
            saveSessions();
        }
    }
    if (!session) {
        session = await getSampleSessionById(req.params.id);
    }
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    res.json(buildSessionResponse(session));
});

app.delete('/api/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    let session = sessions[sessionId];

    if (!session) {
        session = await getSessionFromFirestore(sessionId);
        if (session) {
            sessions[sessionId] = session;
        }
    }

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.isSample) {
        return res.status(403).json({ error: 'Cannot delete sample sessions' });
    }

    try {
        // GCS cleanup
        if (storageClient && storageBucketName) {
            const bucket = storageClient.bucket(storageBucketName);

            // Delete original video object
            if (session.objectPath) {
                try {
                    await bucket.file(session.objectPath).delete({ ignoreNotFound: true });
                } catch (e) {
                    console.warn(`Failed to delete original object ${session.objectPath}:`, e);
                }
            }

            // Delete all generated files (highlight, cover, frames) under the session prefix
            try {
                await bucket.deleteFiles({ prefix: `${generatedObjectPrefix}/${sessionId}/`, force: true });
            } catch (e) {
                console.warn(`Failed to delete generated files for session ${sessionId}:`, e);
            }
        }

        // Local file cleanup
        const safeDelete = (filePath: string | undefined | null) => {
            if (!filePath || typeof filePath !== 'string') return;
            if (!path.isAbsolute(filePath)) return;
            const resolved = path.resolve(filePath);
            if (!resolved.startsWith(path.resolve(config.uploadDir))) return;
            try {
                if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
            } catch (e) {
                console.warn(`Failed to delete local file ${resolved}:`, e);
            }
        };
        safeDelete(session.path);
        safeDelete(session.highlightPath);
        safeDelete(session.coverPath);
        safeDelete(session.proxyPath);

        // Remove discovery post for this session
        const postIdx = discoveryPosts.findIndex((p: any) => p.sessionId === sessionId);
        if (postIdx !== -1) {
            discoveryPosts.splice(postIdx, 1);
            saveDiscoveryPosts();
        }

        // Remove comments for this session
        if (allComments[sessionId]) {
            delete allComments[sessionId];
            saveComments();
        }

        // Firestore cleanup
        if (firestoreClient) {
            try {
                await firestoreClient.collection(sessionCollectionName).doc(sessionId).delete();
            } catch (e) {
                console.warn(`Failed to delete Firestore document for session ${sessionId}:`, e);
            }
        }

        // Remove from in-memory sessions and persist
        delete sessions[sessionId];
        saveSessions();

        console.log(`Session ${sessionId} deleted successfully`);
        res.json({ success: true });
    } catch (error: any) {
        console.error(`Failed to delete session ${sessionId}:`, error);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

app.get('/api/pet-names', (req, res) => {
    const names = [...new Set(
        Object.values(sessions)
            .map((s: any) => s.petName)
            .filter((n: any) => n && typeof n === 'string' && n.trim() !== '')
    )].sort();
    res.json(names);
});

app.get('/api/sessions', (req, res) => {
    const visitorId = String(req.query.visitorId || '').trim();
    let results = Object.values(sessions);
    if (visitorId) {
        results = results.filter((s: any) => !s.visitorId || s.visitorId === visitorId);
    }
    res.json(results
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(buildSessionResponse));
});

app.get('/api/sample-sessions', (req, res) => {
    // Return in-memory sample sessions immediately (already synced from Firestore at startup)
    res.json(sampleSessions
        .map((session: any) => ({ ...buildSessionResponse(session), isSample: true }))
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

// Discovery API - shared posts from users
const discoveryPath = path.join(config.outputDir, 'discovery.json');
let discoveryPosts: any[] = [];

// Load discovery posts from file
if (fs.existsSync(discoveryPath)) {
    try {
        discoveryPosts = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
    } catch (e) {
        discoveryPosts = [];
    }
}

function saveDiscoveryPosts() {
    fs.writeFileSync(discoveryPath, JSON.stringify(discoveryPosts, null, 2));
}

// Get all discovery posts
app.get('/api/discovery', (req, res) => {
    // Enrich posts with session data
    const enrichedPosts = discoveryPosts.map(post => {
        const session = sessions[post.sessionId];
        if (!session) return null;
        return {
            ...post,
            petName: session.petName,
            thumbnail: session.coverUrl || '',
            highlightVideo: session.highlightUrl,
            title: session.analysis?.title || '',
            moodTag: session.analysis?.moodData?.[0]?.name || 'Adventure'
        };
    }).filter(Boolean);

    res.json(enrichedPosts.sort((a: any, b: any) =>
        new Date(b.sharedAt).getTime() - new Date(a.sharedAt).getTime()
    ));
});

// Share a session to discovery
app.post('/api/discovery', (req, res) => {
    const { sessionId, description } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = sessions[sessionId];
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // Check if already shared
    const existingPost = discoveryPosts.find(p => p.sessionId === sessionId);
    if (existingPost) {
        // Update description if re-sharing
        existingPost.description = description || existingPost.description;
        existingPost.sharedAt = new Date().toISOString();
        saveDiscoveryPosts();
        return res.json({ success: true, message: 'Post updated', post: existingPost });
    }

    // Create new discovery post
    const newPost = {
        id: `discovery-${Date.now()}`,
        sessionId,
        description: description || `${session.petName}'s adventure`,
        sharedAt: new Date().toISOString(),
        likes: 0,
        comments: 0
    };

    discoveryPosts.push(newPost);
    saveDiscoveryPosts();

    res.json({ success: true, message: 'Shared to Discovery', post: newPost });
});

// Check if a session is shared to Discovery
app.get('/api/discovery/check/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const post = discoveryPosts.find(p => p.sessionId === sessionId);
    res.json({ isShared: !!post, post: post || null });
});

// Comments storage
const commentsPath = path.join(config.outputDir, 'comments.json');
let allComments: Record<string, any[]> = {};

// Load comments from file
if (fs.existsSync(commentsPath)) {
    try {
        allComments = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
    } catch (e) {
        allComments = {};
    }
}

function saveComments() {
    fs.writeFileSync(commentsPath, JSON.stringify(allComments, null, 2));
}

// Get comments for a session
app.get('/api/comments/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    // Only return comments if the session is shared to Discovery
    const isShared = discoveryPosts.some(p => p.sessionId === sessionId);
    if (!isShared) {
        return res.status(403).json({ error: 'Comments are only available for shared posts' });
    }

    const comments = allComments[sessionId] || [];
    res.json(comments);
});

// Add a comment to a session
app.post('/api/comments/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { userName, userAvatar, content } = req.body;

    // Only allow comments if the session is shared to Discovery
    const isShared = discoveryPosts.some(p => p.sessionId === sessionId);
    if (!isShared) {
        return res.status(403).json({ error: 'Comments are only available for shared posts' });
    }

    if (!content || content.trim() === '') {
        return res.status(400).json({ error: 'Comment content is required' });
    }

    const newComment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userName: userName || 'Anonymous',
        userAvatar: userAvatar || `https://i.pravatar.cc/100?u=${Date.now()}`,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        likes: 0
    };

    if (!allComments[sessionId]) {
        allComments[sessionId] = [];
    }
    allComments[sessionId].unshift(newComment);

    // Update comment count in discovery post
    const discoveryPost = discoveryPosts.find(p => p.sessionId === sessionId);
    if (discoveryPost) {
        discoveryPost.comments = allComments[sessionId].length;
        saveDiscoveryPosts();
    }

    saveComments();
    res.json({ success: true, comment: newComment });
});

function timeToSeconds(timeStr: string): number {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0]; // Just seconds
}

function secondsToTime(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

const ALLOWED_TIMELINE_ICONS = new Set([
    'visibility', 'pets', 'directions_walk', 'directions_run', 'favorite', 'explore', 'speed',
    'park', 'home', 'restaurant', 'bolt', 'terrain', 'forest', 'brush', 'groups', 'stairs',
    'waves', 'search', 'wb_sunny', 'nightlight_round', 'sports_score', 'trending_up',
    'trending_down', 'straighten', 'room', 'auto_fix_high', 'grass', 'meeting_room', 'roofing',
    'south', 'error', 'timeline'
]);

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function pickEvenIndices(length: number, target: number): number[] {
    if (target <= 0 || length <= 0) return [];
    if (target >= length) return Array.from({ length }, (_, i) => i);

    const indices = new Set<number>([0, length - 1]);
    for (let i = 1; i < target - 1; i++) {
        const idx = Math.round((i * (length - 1)) / (target - 1));
        indices.add(idx);
    }

    let result = Array.from(indices).sort((a, b) => a - b);
    let cursor = 0;
    while (result.length < target) {
        if (!indices.has(cursor)) {
            indices.add(cursor);
            result.push(cursor);
        }
        cursor++;
    }

    result.sort((a, b) => a - b);
    return result.slice(0, target);
}

function interpolateMoodValue(points: { sec: number; value: number }[], targetSec: number): number {
    if (points.length === 0) return 50;
    if (points.length === 1) return points[0].value;
    if (targetSec <= points[0].sec) return points[0].value;

    for (let i = 1; i < points.length; i++) {
        const right = points[i];
        const left = points[i - 1];
        if (targetSec <= right.sec) {
            const span = right.sec - left.sec;
            if (span <= 0) return right.value;
            const ratio = (targetSec - left.sec) / span;
            return left.value + (right.value - left.value) * ratio;
        }
    }
    return points[points.length - 1].value;
}

function normalizeMoodData(
    moodData: { name: string; value: number }[] | undefined,
    videoDuration: number
): { name: string; value: number }[] {
    const safeDuration = Math.max(1, Math.round(videoDuration));
    const cleaned = (moodData || [])
        .map(item => {
            const sec = clamp(Math.round(timeToSeconds(item?.name || '0:00')), 0, safeDuration);
            const value = clamp(Math.round(Number(item?.value ?? 50)), 0, 100);
            return { sec, value };
        })
        .filter(item => Number.isFinite(item.sec) && Number.isFinite(item.value))
        .sort((a, b) => a.sec - b.sec);

    // Deduplicate same-second points (keep the latest value to avoid flat duplicates)
    const deduped = new Map<number, number>();
    for (const point of cleaned) deduped.set(point.sec, point.value);
    let points = Array.from(deduped.entries())
        .map(([sec, value]) => ({ sec, value }))
        .sort((a, b) => a.sec - b.sec);

    if (points.length === 0) {
        points = [{ sec: 0, value: 50 }, { sec: safeDuration, value: 50 }];
    } else {
        if (points[0].sec > 0) {
            points.unshift({ sec: 0, value: points[0].value });
        } else {
            points[0].sec = 0;
        }
        if (points[points.length - 1].sec < safeDuration) {
            points.push({ sec: safeDuration, value: points[points.length - 1].value });
        } else {
            points[points.length - 1].sec = safeDuration;
        }
    }

    const targetCount = clamp(Math.round(safeDuration / 12), 20, 30);
    const result: { name: string; value: number }[] = [];
    for (let i = 0; i < targetCount; i++) {
        const sec = i === targetCount - 1 ? safeDuration : Math.round((i * safeDuration) / (targetCount - 1));
        const value = clamp(Math.round(interpolateMoodValue(points, sec)), 0, 100);
        result.push({ name: secondsToTime(sec), value });
    }

    return result;
}

function timelineLabelFromMood(value: number): { label: string; icon: string } {
    if (value >= 85) return { label: 'Zoomies Peak', icon: 'speed' };
    if (value >= 70) return { label: 'Play Burst', icon: 'directions_run' };
    if (value >= 55) return { label: 'Curious Patrol', icon: 'explore' };
    if (value >= 40) return { label: 'Steady Cruise', icon: 'directions_walk' };
    return { label: 'Quiet Reset', icon: 'home' };
}

function normalizeTimeline(
    timeline: { time: string; label: string; icon: string }[] | undefined,
    moodData: { name: string; value: number }[],
    videoDuration: number
): { time: string; label: string; icon: string }[] {
    const safeDuration = Math.max(1, Math.round(videoDuration));
    const targetCount = clamp(Math.round(safeDuration / 24), 15, 20);

    const normalized = (timeline || [])
        .map(item => {
            const sec = clamp(Math.round(timeToSeconds(item?.time || '0:00')), 0, safeDuration);
            const label = (item?.label || '').trim() || 'Story Beat';
            const icon = ALLOWED_TIMELINE_ICONS.has(item?.icon) ? item.icon : 'timeline';
            return { sec, label, icon };
        })
        .filter(item => Number.isFinite(item.sec))
        .sort((a, b) => a.sec - b.sec);

    const dedupedMap = new Map<number, { sec: number; label: string; icon: string }>();
    for (const entry of normalized) dedupedMap.set(entry.sec, entry);
    let entries = Array.from(dedupedMap.values()).sort((a, b) => a.sec - b.sec);

    if (entries.length > 20) {
        entries = pickEvenIndices(entries.length, 20).map(i => entries[i]);
    }

    const secExistsNearby = (sec: number, threshold: number = 12) =>
        entries.some(e => Math.abs(e.sec - sec) <= threshold);

    // Backfill from mood signal if AI timeline is too sparse.
    if (entries.length < 15) {
        const moodCandidates = moodData
            .map(point => ({ sec: timeToSeconds(point.name), value: point.value }))
            .sort((a, b) => {
                const interestA = Math.abs(a.value - 50);
                const interestB = Math.abs(b.value - 50);
                return interestB - interestA;
            });

        for (const candidate of moodCandidates) {
            if (entries.length >= targetCount) break;
            if (!Number.isFinite(candidate.sec) || candidate.sec < 0 || candidate.sec > safeDuration) continue;
            if (secExistsNearby(candidate.sec)) continue;
            const moodTag = timelineLabelFromMood(candidate.value);
            entries.push({
                sec: candidate.sec,
                label: moodTag.label,
                icon: moodTag.icon
            });
        }
    }

    // Final filler to satisfy strict 15-20 requirement.
    let fillerIndex = 1;
    let fillerAttempts = 0;
    while (entries.length < 15 && fillerAttempts < 300) {
        fillerAttempts++;
        const sec = Math.round((fillerIndex * safeDuration) / 15);
        fillerIndex++;
        if (secExistsNearby(sec, 8)) continue;
        entries.push({
            sec,
            label: `Story Beat ${entries.length + 1}`,
            icon: 'timeline'
        });
    }

    // Ultra-short/edge-case fallback: allow dense placeholders if needed.
    while (entries.length < 15) {
        const sec = clamp(entries.length - 1, 0, safeDuration);
        entries.push({
            sec,
            label: `Story Beat ${entries.length + 1}`,
            icon: 'timeline'
        });
    }

    entries.sort((a, b) => a.sec - b.sec);
    if (entries.length > 20) {
        entries = pickEvenIndices(entries.length, 20).map(i => entries[i]);
    }

    return entries.map(item => ({
        time: secondsToTime(item.sec),
        label: item.label,
        icon: item.icon
    }));
}

function mapAndFilterForHighlight<T extends Record<string, any>>(
    arr: T[] | undefined,
    timeField: keyof T & string,
    originalField: string,
    highlights: { start: string; end: string }[]
): T[] {
    if (!arr || !Array.isArray(arr) || highlights.length === 0) return [];
    const mapped: T[] = [];
    for (const item of arr) {
        if (!item || typeof item !== 'object' || !item[timeField]) continue;
        const sourceTime = item[originalField] || item[timeField];
        const mappedTime = mapToHighlightTime(sourceTime, highlights);
        if (mappedTime === null) continue;
        mapped.push({
            ...item,
            [originalField]: sourceTime,
            [timeField]: mappedTime,
            isMapped: true
        });
    }
    return mapped;
}

// Helper function to get source priority for merging decisions
function getSourcePriority(source?: string): number {
    switch (source) {
        case 'safety': return 100;
        case 'friend+scenery': return 95;  // Combo: friend + scenery
        case 'friend': return 80;
        case 'food': return 60;
        case 'scenery': return 40;
        default: return 10;  // AI generated
    }
}

function mergeOverlappingSegments(segments: any[]): any[] {
    if (segments.length <= 1) return segments;

    const merged: any[] = [];
    let current = { ...segments[0] };  // Preserve all fields

    for (let i = 1; i < segments.length; i++) {
        const next = segments[i];
        const currentEnd = timeToSeconds(current.end);
        const nextStart = timeToSeconds(next.start);

        // If segments overlap or are adjacent (within 2 seconds), merge them
        if (nextStart <= currentEnd + 2) {
            const nextEnd = timeToSeconds(next.end);
            if (nextEnd > currentEnd) {
                current.end = next.end;
            }

            // Detect friend + scenery combination (highest value content)
            const sources = [current.source, next.source].filter(Boolean);
            const hasFriend = sources.includes('friend') || sources.includes('friend+scenery');
            const hasScenery = sources.includes('scenery') || sources.includes('friend+scenery');

            if (hasFriend && hasScenery) {
                // This is a friend + scenery combo - mark it as highest priority
                current.source = 'friend+scenery';
                current.friendName = current.friendName || next.friendName;
                current.isHighQuality = current.isHighQuality || next.isHighQuality;
                console.log(`[Merge] Detected friend+scenery combo: ${current.start}-${current.end}`);
            } else if (getSourcePriority(next.source) > getSourcePriority(current.source)) {
                // When merging, keep the higher priority source
                current.source = next.source;
                current.friendName = next.friendName || current.friendName;
            }

            // Preserve high quality flag and keep the higher score
            current.isHighQuality = current.isHighQuality || next.isHighQuality;
            current.score = Math.max(current.score || 0, next.score || 0);
        } else {
            merged.push(current);
            current = { ...next };  // Preserve all fields
        }
    }
    merged.push(current);

    return merged;
}

function ensureFriendsInHighlights(
    friends: any[],
    highlightTimestamps: any[],
    videoDuration: number,
    bufferSeconds: number = 3
): any[] {
    if (!friends || friends.length === 0) return highlightTimestamps;

    let segments = highlightTimestamps.map(s => ({ ...s }));  // Preserve all fields

    for (const friend of friends) {
        // Get all timestamps for this friend (from timestamps array or fallback to single timestamp)
        const allTimestamps: { time: string; duration?: number }[] = friend.timestamps?.length > 0
            ? friend.timestamps
            : friend.timestamp ? [{ time: friend.timestamp, duration: friend.duration }] : [];

        for (const ts of allTimestamps) {
            const friendTime = timeToSeconds(ts.time);
            const friendDuration = ts.duration || friend.duration || 5;

            // Check if this timestamp is within any existing segment
            const isIncluded = segments.some(seg => {
                const segStart = timeToSeconds(seg.start);
                const segEnd = timeToSeconds(seg.end);
                return friendTime >= segStart && friendTime <= segEnd;
            });

            if (!isIncluded) {
                // Create a new segment for this friend encounter
                const newSegStart = Math.max(0, friendTime - bufferSeconds);
                const newSegEnd = Math.min(videoDuration, friendTime + Math.max(friendDuration, bufferSeconds));

                segments.push({
                    start: secondsToTime(newSegStart),
                    end: secondsToTime(newSegEnd),
                    source: 'friend',
                    friendName: friend.name,
                    isHighQuality: false
                });

                console.log(`[Friend Inclusion] Added segment ${secondsToTime(newSegStart)}-${secondsToTime(newSegEnd)} for friend "${friend.name}" at ${ts.time}`);
            }
        }
    }

    // Sort by start time
    segments.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));

    // Merge overlapping segments
    return mergeOverlappingSegments(segments);
}

function ensureSceneryInHighlights(
    scenery: any[],
    highlightTimestamps: any[],
    videoDuration: number,
    bufferSeconds: number = 2
): any[] {
    if (!scenery || scenery.length === 0) return highlightTimestamps;

    let segments = highlightTimestamps.map(s => ({ ...s }));  // Preserve all fields

    // Only ensure coverage for scenery with stayDuration >= 3s
    const significantScenery = scenery.filter(s => s.stayDuration >= 3 && s.timestamp);

    // Identify high-quality scenery (stayDuration >= 5s)
    const highQualitySceneryTimes = scenery
        .filter(s => s.stayDuration >= 5 && s.timestamp)
        .map(s => timeToSeconds(s.timestamp));

    for (const scene of significantScenery) {
        const sceneTime = timeToSeconds(scene.timestamp);
        const sceneDuration = scene.stayDuration || 5;
        const isHighQuality = sceneDuration >= 5;

        // Check if this timestamp is within any existing segment
        const existingSegmentIndex = segments.findIndex(seg => {
            const segStart = timeToSeconds(seg.start);
            const segEnd = timeToSeconds(seg.end);
            return sceneTime >= segStart && sceneTime <= segEnd;
        });

        if (existingSegmentIndex >= 0) {
            // Mark existing segment as covering scenery (for friend+scenery detection)
            const existingSeg = segments[existingSegmentIndex];
            if (existingSeg.source === 'friend') {
                // Friend segment contains scenery → upgrade to friend+scenery combo (priority 95)
                existingSeg.source = 'friend+scenery';
                console.log(`[Scenery] Upgraded segment ${existingSeg.start}-${existingSeg.end} to friend+scenery combo`);
            } else if (!existingSeg.source || existingSeg.source === 'ai') {
                existingSeg.source = 'scenery';
            }
            // Mark as high quality if this is a high-quality scenery moment
            if (isHighQuality) {
                existingSeg.isHighQuality = true;
                console.log(`[Scenery] Marked existing segment ${existingSeg.start}-${existingSeg.end} as high-quality scenery`);
            }
        } else {
            // Create a new segment for this scenery
            const clipDuration = Math.min(sceneDuration, 5);
            const newSegStart = Math.max(0, sceneTime - bufferSeconds);
            const newSegEnd = Math.min(videoDuration, sceneTime + clipDuration);

            // Detect nearby friend segments (gap <= 10s)
            // Threshold note: current case has 7s gap, 10s provides margin.
            // False-boost risk is low: only affects stayDuration>=3 scenery, each clip is 3-5s budget.
            const hasNearbyFriend = segments.some(seg => {
                if (seg.source !== 'friend' && seg.source !== 'friend+scenery') return false;
                const segStart = timeToSeconds(seg.start);
                const segEnd = timeToSeconds(seg.end);
                const gapAfter = segStart - newSegEnd;
                const gapBefore = newSegStart - segEnd;
                return (gapAfter >= 0 && gapAfter <= 10) || (gapBefore >= 0 && gapBefore <= 10);
            });

            segments.push({
                start: secondsToTime(newSegStart),
                end: secondsToTime(newSegEnd),
                source: 'scenery',
                isHighQuality: isHighQuality,
                isNearFriend: hasNearbyFriend
            });

            if (hasNearbyFriend) {
                console.log(`[Scenery] Near-friend scenery: "${scene.sceneryLabel || scene.description}" at ${secondsToTime(newSegStart)}-${secondsToTime(newSegEnd)} (priority boosted to 85)`);
            }
            console.log(`[Scenery Inclusion] Added ${isHighQuality ? 'HIGH-QUALITY ' : ''}segment ${secondsToTime(newSegStart)}-${secondsToTime(newSegEnd)} for "${scene.sceneryLabel || scene.description}" (stayDuration: ${sceneDuration}s)`);
        }
    }

    segments.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
    return mergeOverlappingSegments(segments);
}

function ensureFoodInHighlights(
    dietaryHabits: any[],
    highlightTimestamps: any[],
    videoDuration: number,
    bufferSeconds: number = 1
): any[] {
    if (!dietaryHabits || dietaryHabits.length === 0) return highlightTimestamps;

    let segments = highlightTimestamps.map(s => ({ ...s }));  // Preserve all fields

    for (const habit of dietaryHabits) {
        if (!habit.timestamp) continue;

        const foodTime = timeToSeconds(habit.timestamp);

        // Check if already covered by existing highlights
        const isIncluded = segments.some(seg => {
            const segStart = timeToSeconds(seg.start);
            const segEnd = timeToSeconds(seg.end);
            return foodTime >= segStart && foodTime <= segEnd;
        });

        if (!isIncluded) {
            // Create a short clip (3-4s) around the food timestamp
            // Food clips should be brief - just enough to show the eating/drinking
            const clipDuration = 3;
            const newSegStart = Math.max(0, foodTime - bufferSeconds);
            const newSegEnd = Math.min(videoDuration, foodTime + clipDuration);

            segments.push({
                start: secondsToTime(newSegStart),
                end: secondsToTime(newSegEnd),
                source: 'food'
            });

            console.log(`[Food Inclusion] Added segment ${secondsToTime(newSegStart)}-${secondsToTime(newSegEnd)} for "${habit.item}" (${habit.action}) at ${habit.timestamp}`);
        }
    }

    segments.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
    return mergeOverlappingSegments(segments);
}

function ensureSafetyAlertsInHighlights(
    safetyAlerts: any[],
    highlightTimestamps: any[],
    videoDuration: number,
    bufferSeconds: number = 1
): any[] {
    if (!safetyAlerts || safetyAlerts.length === 0) return highlightTimestamps;

    let segments = highlightTimestamps.map(s => ({ ...s }));  // Preserve all fields

    for (const alert of safetyAlerts) {
        if (!alert.timestamp) continue;

        const alertTime = timeToSeconds(alert.timestamp);

        // Check if already covered by existing highlights
        const isIncluded = segments.some(seg => {
            const segStart = timeToSeconds(seg.start);
            const segEnd = timeToSeconds(seg.end);
            return alertTime >= segStart && alertTime <= segEnd;
        });

        if (!isIncluded) {
            // Create a clip around the safety alert timestamp
            // Danger alerts get longer clips (4-5s) to show context, warnings get shorter (3-4s)
            const clipDuration = alert.type === 'danger' ? 4 : 3;
            const newSegStart = Math.max(0, alertTime - bufferSeconds);
            const newSegEnd = Math.min(videoDuration, alertTime + clipDuration);

            segments.push({
                start: secondsToTime(newSegStart),
                end: secondsToTime(newSegEnd),
                source: 'safety'
            });

            console.log(`[Safety Inclusion] Added segment ${secondsToTime(newSegStart)}-${secondsToTime(newSegEnd)} for "${alert.type}" alert: "${alert.message}" at ${alert.timestamp}`);
        }
    }

    segments.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
    return mergeOverlappingSegments(segments);
}

function validateFriendCoverage(
    friends: any[],
    highlightTimestamps: { start: string; end: string }[]
): { start: string; end: string }[] {
    if (!friends || friends.length === 0) return highlightTimestamps;

    let segments = [...highlightTimestamps];

    for (const friend of friends) {
        // Get all timestamps for this friend (from timestamps array or fallback to single timestamp)
        const allTimestamps: { time: string; duration?: number }[] = friend.timestamps?.length > 0
            ? friend.timestamps
            : friend.timestamp ? [{ time: friend.timestamp, duration: friend.duration }] : [];

        for (const ts of allTimestamps) {
            const friendStart = timeToSeconds(ts.time);
            const friendDuration = ts.duration || 5;
            const friendEnd = friendStart + friendDuration;

            // Check if friend's full interaction time [friendStart, friendEnd] is covered
            let covered = false;
            for (const seg of segments) {
                const segStart = timeToSeconds(seg.start);
                const segEnd = timeToSeconds(seg.end);

                // Check if at least 3 seconds (or full duration if shorter) of the interaction is covered
                const overlapStart = Math.max(friendStart, segStart);
                const overlapEnd = Math.min(friendEnd, segEnd);
                const overlapDuration = overlapEnd - overlapStart;

                if (overlapDuration >= Math.min(3, friendDuration)) {
                    covered = true;
                    break;
                }
            }

            if (!covered) {
                // Friend's interaction time is not sufficiently covered, create new segment
                // Take the middle 3-5 seconds of the interaction or full interaction (whichever is shorter)
                const clipDuration = Math.min(friendDuration, 5);
                const clipStart = friendStart + (friendDuration - clipDuration) / 2;
                const clipEnd = clipStart + clipDuration;

                segments.push({
                    start: secondsToTime(Math.max(0, clipStart - 1)),
                    end: secondsToTime(clipEnd + 1)
                });

                console.log(`[Friend Coverage] Added segment ${secondsToTime(clipStart)}-${secondsToTime(clipEnd)} for "${friend.name}" at ${ts.time} (duration: ${friendDuration}s)`);
            }
        }
    }

    // Sort and merge overlapping segments
    segments.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
    return mergeOverlappingSegments(segments);
}

function mapToHighlightTime(originalTimeStr: string, highlightTimestamps: { start: string, end: string }[]): string | null {
    if (!highlightTimestamps || highlightTimestamps.length === 0) return null;
    const t = timeToSeconds(originalTimeStr);
    let highlightOffset = 0;

    for (const seg of highlightTimestamps) {
        const segStart = timeToSeconds(seg.start);
        const segEnd = timeToSeconds(seg.end);

        // Only return valid time if within a highlight segment
        if (t >= segStart && t <= segEnd) {
            return secondsToTime(highlightOffset + (t - segStart));
        }

        highlightOffset += (segEnd - segStart);
    }

    // Not within any highlight segment - return null to indicate unmappable
    return null;
}

// Session Migration: Map timestamps for any existing ready sessions that haven't been mapped yet
async function migrateSessions() {
    let migratedCount = 0;
    for (const id in sessions) {
        const session = sessions[id];
        if (session.status === 'ready' && session.analysis) {
            // Retroactive originalDuration
            if (!session.originalDuration && session.path && fs.existsSync(session.path)) {
                session.originalDuration = await getVideoDuration(session.path);
                migratedCount++;
            }

            const highlights = session.analysis.highlightTimestamps || [];
            if (highlights.length === 0) continue;

            // For friends/scenery, don't filter - they should remain in analysis data
            // Just map those that can be mapped
            const mapArrayNoFilter = (arr: any[], timeField: string) => {
                arr?.forEach(item => {
                    if (item && typeof item === 'object' && item[timeField] && !item.isMapped) {
                        const mappedTime = mapToHighlightTime(item[timeField], highlights);
                        if (mappedTime !== null) {
                            item[timeField] = mappedTime;
                            item.isMapped = true;
                            migratedCount++;
                        }
                    }
                });
            };

            mapArrayNoFilter(session.analysis.friends, 'timestamp');
            mapArrayNoFilter(session.analysis.scenery, 'timestamp');

            // Keep original timeline/moodData intact; store highlight-only mapped copies.
            if (!session.analysis.timelineHighlight) {
                session.analysis.timelineHighlight = mapAndFilterForHighlight(
                    session.analysis.timeline,
                    'time',
                    'originalTime',
                    highlights
                );
                migratedCount += session.analysis.timelineHighlight.length;
            }
            if (!session.analysis.moodDataHighlight) {
                session.analysis.moodDataHighlight = mapAndFilterForHighlight(
                    session.analysis.moodData,
                    'name',
                    'originalTime',
                    highlights
                );
                migratedCount += session.analysis.moodDataHighlight.length;
            }

            // For narrativeSegments - keep ALL but mark with inHighlight flag
            // This allows original video to show all subtitles, highlight video to show only matching ones
            if (session.analysis.narrativeSegments) {
                session.analysis.narrativeSegments = session.analysis.narrativeSegments.map((seg: any) => {
                    if (seg.isMapped) return seg;  // Already migrated

                    const mappedTime = mapToHighlightTime(seg.timestamp, highlights);
                    const inHighlight = mappedTime !== null;
                    migratedCount++;

                    return {
                        ...seg,
                        originalTime: seg.timestamp,
                        timestamp: mappedTime || seg.timestamp,
                        inHighlight: inHighlight,
                        isMapped: true
                    };
                });
            }
        }
    }
    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} sessions/timestamps in existing sessions.`);
        saveSessions();
    }
}

async function processVideo(sessionId: string, localPathFromUpload?: string) {
    const stageTimes: StageTime[] = [];
    const totalStart = Date.now();
    let cleanupPaths: string[] = [];

    const logStage = (stage: string, startTime: number) => {
        const duration = (Date.now() - startTime) / 1000;
        stageTimes.push({ stage, duration, startedAt: startTime, completedAt: Date.now() });
        console.log(`[Timing] ${stage}: ${formatDuration(duration)}`);
    };

    const updateProgress = (stage: string, percent: number, stageIndex: number, totalStages = 5) => {
        if (sessions[sessionId]) {
            sessions[sessionId].progress = { stage, percent, stageIndex, totalStages };
        }
    };

    try {
        updateProgress('Preparing Video', 0, 0);

        let stageStart = Date.now();
        const resolvedInput = await resolveProcessingVideoInput(sessionId, localPathFromUpload);
        cleanupPaths = resolvedInput.cleanupPaths || [];
        logStage('Resolve Processing Input', stageStart);

        const videoPath = resolvedInput.inputPath;

        // Stage 1: Proxy Video Creation
        stageStart = Date.now();
        const proxyPath = await createProxyVideo(videoPath, config.uploadDir);
        if (/^https?:\/\//i.test(proxyPath)) {
            throw new Error('Failed to create local proxy video from source file.');
        }
        logStage('Proxy Video Creation', stageStart);
        updateProgress('AI Analysis', 10, 1);

        // Stage 2: Get Video Duration
        stageStart = Date.now();
        const videoDuration = await getVideoDuration(videoPath);
        logStage('Get Video Duration', stageStart);

        // Stage 3: Gemini AI Analysis (includes upload, processing wait, and generation)
        stageStart = Date.now();
        const analysisData = await analyzeVideo(proxyPath);
        logStage('Gemini AI Analysis (total)', stageStart);

        // Normalize generated signals before any highlight-based mapping.
        analysisData.moodData = normalizeMoodData(analysisData.moodData, videoDuration);
        analysisData.timeline = normalizeTimeline(analysisData.timeline, analysisData.moodData, videoDuration);

        // === Highlight duration check and fallback ===
        let highlights = analysisData.highlightTimestamps || [];

        // Calculate total duration
        const calculateDuration = (segs: typeof highlights) =>
            segs.reduce((sum, seg) => sum + (timeToSeconds(seg.end) - timeToSeconds(seg.start)), 0);

        const totalDuration = calculateDuration(highlights);
        console.log(`[Highlight] AI returned ${highlights.length} clips, total duration: ${totalDuration}s`);

        // Log scores and reasons for debugging
        highlights.forEach((clip, i) => {
            if (clip.reason || clip.score) {
                console.log(`  [Clip ${i + 1}] ${clip.start}-${clip.end} | Score: ${clip.score || 'N/A'} | ${clip.reason || ''}`);
            }
        });

        // Fallback: if duration exceeds 120s, trim by score (with protection for important content)
        if (totalDuration > 120) {
            console.log(`[Highlight] Duration ${totalDuration}s exceeds 120s, trimming...`);

            // Collect important timestamps from friends and high-quality scenery
            const friendTimes = (analysisData.friends || []).flatMap(f =>
                f.timestamps?.map((t: any) => timeToSeconds(t.time)) || [timeToSeconds(f.timestamp)]
            ).filter(Boolean);

            const highQualitySceneryTimes = (analysisData.scenery || [])
                .filter(s => s.stayDuration >= 5 && s.timestamp)
                .map(s => timeToSeconds(s.timestamp));

            // Check if a clip covers any important timestamp
            const coversImportantContent = (clip: any): boolean => {
                const clipStart = timeToSeconds(clip.start);
                const clipEnd = timeToSeconds(clip.end);

                const coversFriend = friendTimes.some(t => t >= clipStart && t <= clipEnd);
                const coversScenery = highQualitySceneryTimes.some(t => t >= clipStart && t <= clipEnd);

                return coversFriend || coversScenery;
            };

            // Enhanced sorting: score + importance bonus
            const getEnhancedScore = (clip: any): number => {
                let score = clip.score || 0;
                if (coversImportantContent(clip)) {
                    score += 50;  // Bonus for covering important content
                    console.log(`  [Protection] Clip ${clip.start}-${clip.end} covers important content, score boosted`);
                }
                return score;
            };

            const sorted = [...highlights].sort((a, b) => getEnhancedScore(b) - getEnhancedScore(a));
            const kept: typeof highlights = [];
            let currentDuration = 0;

            for (const clip of sorted) {
                const clipDuration = timeToSeconds(clip.end) - timeToSeconds(clip.start);
                if (currentDuration + clipDuration <= 120) {
                    kept.push(clip);
                    currentDuration += clipDuration;
                }
            }

            // Sort back to chronological order
            kept.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
            highlights = kept;

            console.log(`[Highlight] Trimmed to ${kept.length} clips, duration: ${calculateDuration(kept)}s`);
        }

        // Cap unrealistic stayDuration values
        if (analysisData.scenery) {
            for (const scene of analysisData.scenery) {
                if (typeof scene.stayDuration === 'number' && scene.stayDuration > 15) {
                    console.log(`[Scenery Cap] "${scene.sceneryLabel || scene.description}" stayDuration ${scene.stayDuration}s → capped to 15s`);
                    scene.stayDuration = 15;
                }
            }
        }

        // Ensure all friend timestamps are included in highlights
        highlights = ensureFriendsInHighlights(
            analysisData.friends,
            highlights,
            videoDuration,
            3  // 3 second buffer
        );

        // Ensure significant scenery moments are included in highlights
        highlights = ensureSceneryInHighlights(
            analysisData.scenery,
            highlights,
            videoDuration,
            2
        );

        // Ensure dietary habits (food/drink) moments are included in highlights
        highlights = ensureFoodInHighlights(
            analysisData.dietaryHabits,
            highlights,
            videoDuration,
            1  // 1 second buffer before food moment
        );

        // Ensure safety alerts (danger/warning) are included in highlights
        highlights = ensureSafetyAlertsInHighlights(
            analysisData.safetyAlerts,
            highlights,
            videoDuration,
            1  // 1 second buffer before alert moment
        );

        // ========== Final duration check and smart layered trimming ==========
        const finalDuration = calculateDuration(highlights);
        const MAX_HIGHLIGHT_DURATION = 120;

        if (finalDuration > MAX_HIGHLIGHT_DURATION) {
            console.log(`[Highlight] Final duration ${finalDuration.toFixed(1)}s exceeds ${MAX_HIGHLIGHT_DURATION}s, smart trimming...`);

            // Assign priority to clips (higher = more important, kept longer)
            const getPriority = (clip: any): number => {
                if (clip.source === 'safety') return 100;
                if (clip.source === 'friend+scenery') return 95;  // Friend + Scenery combo: highest value content
                if (clip.source === 'scenery' && clip.isNearFriend) return 85;  // Near-friend scenery: context preservation
                if (clip.source === 'friend') return 80;
                if (clip.source === 'scenery' && clip.isHighQuality) return 75;  // High-quality scenery (stayDuration >= 5s)
                if (clip.source === 'food') return 60;
                if (clip.source === 'scenery') return 50;  // Regular scenery (raised from 40)
                const score = clip.score || 0;
                if (score >= 15) return 30;
                if (score >= 10) return 20;
                return 10;
            };

            // Sort by priority (high priority first, will be kept)
            const sorted = [...highlights].sort((a, b) => getPriority(b) - getPriority(a));

            const kept: typeof highlights = [];
            let currentDuration = 0;
            const friendsIncluded = new Set<string>();

            for (const clip of sorted) {
                let clipDuration = timeToSeconds(clip.end) - timeToSeconds(clip.start);

                // Check if this is the only clip for a friend
                const isOnlyFriendClip = clip.source === 'friend' &&
                    clip.friendName &&
                    !friendsIncluded.has(clip.friendName);

                // Compression strategy: if not enough space but clip is important, try to shorten
                if (currentDuration + clipDuration > MAX_HIGHLIGHT_DURATION) {
                    const remaining = MAX_HIGHLIGHT_DURATION - currentDuration;

                    // Safety: never delete, but can shorten to 3s minimum
                    if (clip.source === 'safety' && remaining >= 3) {
                        clip.end = secondsToTime(timeToSeconds(clip.start) + Math.max(3, remaining));
                        clipDuration = remaining;
                        console.log(`[Highlight] Compressed safety clip to ${remaining.toFixed(1)}s`);
                    }
                    // Friend's only clip: allow slight overage or shorten
                    else if (isOnlyFriendClip) {
                        if (remaining >= 3) {
                            clip.end = secondsToTime(timeToSeconds(clip.start) + Math.max(3, remaining));
                            clipDuration = remaining;
                            console.log(`[Highlight] Compressed friend "${clip.friendName}" clip to ${remaining.toFixed(1)}s`);
                        } else if (currentDuration + clipDuration <= MAX_HIGHLIGHT_DURATION + 5) {
                            // Allow up to 5s overage to keep friend's only clip
                            console.log(`[Highlight] Kept only clip for friend "${clip.friendName}" (allowing slight overage)`);
                        }
                    }
                }

                if (currentDuration + clipDuration <= MAX_HIGHLIGHT_DURATION ||
                    (isOnlyFriendClip && currentDuration + clipDuration <= MAX_HIGHLIGHT_DURATION + 5)) {
                    kept.push(clip);
                    currentDuration += clipDuration;
                    if (clip.friendName) friendsIncluded.add(clip.friendName);
                } else {
                    console.log(`[Highlight] Trimmed: ${clip.start}-${clip.end} (priority: ${getPriority(clip)}, source: ${clip.source || 'ai'})`);
                }
            }

            // Re-sort by time to maintain narrative coherence
            kept.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
            highlights = kept;

            console.log(`[Highlight] Final: ${kept.length} clips, duration: ${calculateDuration(kept).toFixed(1)}s`);
        }
        // ========== End: Final duration check ==========

        // ========== Scenery zero-coverage fallback ==========
        // Fix 1+2 should protect key scenery in the main trimming flow.
        // This fallback only handles extreme edge cases where all scenery was still trimmed.
        if (analysisData.scenery && analysisData.scenery.length > 0) {
            const significantScenery = analysisData.scenery.filter(
                (s: any) => s.stayDuration >= 3 && s.timestamp
            );

            if (significantScenery.length > 0) {
                const hasSceneryCoverage = significantScenery.some((scene: any) => {
                    const t = timeToSeconds(scene.timestamp);
                    return highlights.some(seg =>
                        t >= timeToSeconds(seg.start) && t <= timeToSeconds(seg.end)
                    );
                });

                if (!hasSceneryCoverage) {
                    // Pick best scenery: prefer near-friend (narrative value), then longest stayDuration
                    const bestScene = [...significantScenery].sort((a: any, b: any) => {
                        const aFriend = a.isNearFriend ? 1 : 0;
                        const bFriend = b.isNearFriend ? 1 : 0;
                        if (bFriend !== aFriend) return bFriend - aFriend;
                        return (b.stayDuration || 0) - (a.stayDuration || 0);
                    })[0];
                    const t = timeToSeconds(bestScene.timestamp);
                    const clipLen = Math.min(bestScene.stayDuration || 3, 5);
                    const start = Math.max(0, t - 2);
                    const end = Math.min(videoDuration, t + clipLen);

                    if (calculateDuration(highlights) + (end - start) <= MAX_HIGHLIGHT_DURATION + 5) {
                        highlights.push({
                            start: secondsToTime(start),
                            end: secondsToTime(end),
                            source: 'scenery',
                            isHighQuality: true
                        });
                        highlights.sort((a, b) => timeToSeconds(a.start) - timeToSeconds(b.start));
                        console.log(`[Scenery Fallback] Added ${secondsToTime(start)}-${secondsToTime(end)} (no scenery survived trimming)`);
                    } else {
                        console.log(`[Scenery Fallback] Skipped: adding scenery would exceed ${MAX_HIGHLIGHT_DURATION + 5}s`);
                    }
                }
            }
        }
        // ========== End: Scenery zero-coverage fallback ==========

        analysisData.highlightTimestamps = highlights;
        // === End of highlight processing ===

        // Stage 4+5: Highlight Video Generation AND Frame Extraction (parallel)
        // These two tasks have no dependency — frame extraction uses proxyPath + highlight timestamps
        // (already computed), not the generated highlight video file.
        updateProgress('Creating Highlights', 55, 2);
        const parallelStart = Date.now();

        // Shared results from Task B (frame extraction)
        let coverPath: string | undefined;
        let coverUrl: string | undefined;
        let coverObjectPath: string | null = null;

        const [highlightResult] = await Promise.all([
            // Task A: Generate highlight video + upload to GCS
            (async () => {
                const taskAStart = Date.now();
                const generatedHighlightPath = await generateHighlights(proxyPath, analysisData, config.uploadDir, `${sessionId}`);
                logStage('Highlight Video Generation', taskAStart);

                // A failed highlight generation may return the original input path/URL.
                // Only publish highlight URL when the generated local file actually exists.
                const isUsableHighlightPath =
                    !!generatedHighlightPath &&
                    generatedHighlightPath !== proxyPath &&
                    !/^https?:\/\//i.test(generatedHighlightPath) &&
                    fs.existsSync(generatedHighlightPath);
                const highlightPath = isUsableHighlightPath ? generatedHighlightPath : null;
                let highlightError: string | null = isUsableHighlightPath
                    ? null
                    : 'Highlight video is unavailable for this session. Please use the original video.';
                let highlightObjectPath: string | null = null;
                let highlightUrl: string | null = highlightPath ? getFileUrl(highlightPath) : null;

                if (highlightPath) {
                    try {
                        highlightObjectPath = await uploadGeneratedAsset(sessionId, 'highlight', highlightPath);
                        if (highlightObjectPath) {
                            highlightUrl = getSessionHighlightAssetUrl(sessionId);
                        }
                    } catch (error) {
                        console.error(`[Storage] Failed to upload highlight asset for ${sessionId}:`, error);
                    }
                }

                // On Cloud Storage sessions, local highlight files are ephemeral.
                // If upload failed, do not publish a dead /uploads URL that leads to black playback.
                if (sessions[sessionId]?.objectPath && !highlightObjectPath) {
                    highlightUrl = null;
                    if (!highlightError) {
                        highlightError = 'Highlight was generated but could not be published. Please retry this session.';
                    }
                }

                return { highlightPath, highlightError, highlightObjectPath, highlightUrl };
            })(),

            // Task B: Friend / Scene / Dietary / Cover frame extraction (sequential within, parallel with Task A)
            (async () => {
                updateProgress('Extracting Frames', 60, 3);
                // Stage 5: Friend Frame Extraction (Proxy Mosaic Search)
                const friendStart = Date.now();
                console.log("Starting Mosaic Search Friend Extraction...");
                console.log(`[Friend] Processing ${analysisData.friends.length} friend(s) with concurrency=${friendProcessingConcurrency}`);

                const CONFIDENCE_FLOOR = 25;
                await runWithConcurrencyLimit(analysisData.friends, friendProcessingConcurrency, async (friend) => {
                    const timestamp = (friend as any).best_photo_timestamp || friend.timestamp;
                    if (!timestamp) return;

                    console.log(`[Friend] Mosaic Search for "${friend.name}" (${friend.type}) at ${timestamp}`);

                    let selectedFramePath: string | undefined;
                    const avatarMeta: Record<string, any> = {
                        mode: 'unknown',
                        cellIndex: null,
                        confidence: null,
                        isMultiTimestamp: false,
                        selectedFrameIndex: null,
                        primaryFrameIndex: null,
                        usedBox: 'none',
                        timestampUsed: timestamp
                    };

                    try {
                        const framePaths = await extractMosaicFrames(
                            proxyPath,
                            timestamp,
                            config.uploadDir,
                            `friend-${friend.name.replace(/\s+/g, '_')}`,
                            friend.timestamps
                        );

                        const isMultiTimestamp = !!(friend.timestamps && friend.timestamps.length > 1);
                        const primaryIdx = isMultiTimestamp ? 2 : 4;
                        const primaryFallbackFrame = framePaths[primaryIdx] || framePaths[0];
                        avatarMeta.isMultiTimestamp = isMultiTimestamp;
                        avatarMeta.primaryFrameIndex = primaryIdx;

                        const mosaicUniqueId = Math.random().toString(36).substring(7);
                        const mosaicPath = path.join(config.uploadDir, `friend-${friend.name.replace(/\s+/g, '_')}-mosaic-${mosaicUniqueId}.jpg`);
                        await createMosaic(framePaths, mosaicPath);

                        const result = await detectInMosaic(
                            mosaicPath,
                            friend.type,
                            friend.visual_traits || friend.name
                        );

                        avatarMeta.cellIndex = result?.cellIndex ?? null;
                        avatarMeta.confidence = result?.confidence ?? null;

                        const confidenceOk = result && result.cellIndex >= 1 && result.cellIndex <= 9
                            && (result.confidence || 0) >= CONFIDENCE_FLOOR;

                        if (confidenceOk) {
                            const selectedIdx = result!.cellIndex - 1;
                            const selectedFrame = framePaths[selectedIdx];
                            avatarMeta.selectedFrameIndex = selectedIdx;

                            if (selectedFrame && fs.existsSync(selectedFrame)) {
                                selectedFramePath = selectedFrame;
                                const croppedPath = await cropImageWithBox(
                                    selectedFrame,
                                    result!.box,
                                    config.uploadDir,
                                    'friend'
                                );
                                const fObjPath = await uploadFrameAsset(sessionId, 'friend', croppedPath);
                                if (fObjPath) (friend as any).imageObjectPath = fObjPath;
                                friend.url = fObjPath
                                    ? getSessionFrameAssetUrl(sessionId, fObjPath)
                                    : (getFileUrl(croppedPath) || undefined);
                                avatarMeta.mode = 'mosaic_selected';
                                avatarMeta.usedBox = 'result_box';
                                console.log(`[Friend] "${friend.name}" → cell ${result!.cellIndex}, confidence ${result!.confidence}%`);
                            } else {
                                console.warn(`[Friend] Selected frame missing for "${friend.name}", using primary fallback`);
                                const centerFrame = primaryFallbackFrame;
                                if (centerFrame && fs.existsSync(centerFrame)) {
                                    selectedFramePath = centerFrame;
                                    const fObjPath2 = await uploadFrameAsset(sessionId, 'friend', centerFrame);
                                    if (fObjPath2) (friend as any).imageObjectPath = fObjPath2;
                                    friend.url = fObjPath2
                                        ? getSessionFrameAssetUrl(sessionId, fObjPath2)
                                        : (getFileUrl(centerFrame) || undefined);
                                    avatarMeta.mode = 'fallback_primary';
                                    avatarMeta.selectedFrameIndex = primaryIdx;
                                }
                            }
                        } else {
                            if (result && (result.confidence || 0) < CONFIDENCE_FLOOR) {
                                console.warn(`[Friend] "${friend.name}" confidence ${result.confidence}% < ${CONFIDENCE_FLOOR}%, using primary fallback`);
                            } else {
                                console.log(`[Friend] No clear detection for "${friend.name}", using primary fallback`);
                            }
                            const centerFrame = primaryFallbackFrame;
                            if (centerFrame && fs.existsSync(centerFrame)) {
                                selectedFramePath = centerFrame;
                                avatarMeta.selectedFrameIndex = primaryIdx;
                                const usingPrimaryFrame = (centerFrame === primaryFallbackFrame);
                                if (friend.box && usingPrimaryFrame) {
                                    try {
                                        const croppedPath = await cropImageWithBox(
                                            centerFrame, friend.box, config.uploadDir, 'friend'
                                        );
                                        const fObjPath3 = await uploadFrameAsset(sessionId, 'friend', croppedPath);
                                        if (fObjPath3) (friend as any).imageObjectPath = fObjPath3;
                                        friend.url = fObjPath3
                                            ? getSessionFrameAssetUrl(sessionId, fObjPath3)
                                            : (getFileUrl(croppedPath) || undefined);
                                        selectedFramePath = croppedPath;
                                        avatarMeta.mode = 'fallback_primary';
                                        avatarMeta.usedBox = 'friend_box';
                                    } catch (e) {
                                        console.warn(`[Friend] Fallback crop failed for "${friend.name}", using uncropped frame`);
                                        const fObjPath4 = await uploadFrameAsset(sessionId, 'friend', centerFrame);
                                        if (fObjPath4) (friend as any).imageObjectPath = fObjPath4;
                                        friend.url = fObjPath4
                                            ? getSessionFrameAssetUrl(sessionId, fObjPath4)
                                            : (getFileUrl(centerFrame) || undefined);
                                        avatarMeta.mode = 'fallback_uncropped';
                                    }
                                } else {
                                    if (friend.box && !usingPrimaryFrame) {
                                        console.warn(`[Friend] "${friend.name}" skip crop: box from primary but frame is not`);
                                    }
                                    const fObjPath5 = await uploadFrameAsset(sessionId, 'friend', centerFrame);
                                    if (fObjPath5) (friend as any).imageObjectPath = fObjPath5;
                                    friend.url = fObjPath5
                                        ? getSessionFrameAssetUrl(sessionId, fObjPath5)
                                        : (getFileUrl(centerFrame) || undefined);
                                    avatarMeta.mode = friend.box ? 'fallback_uncropped' : 'fallback_primary';
                                }
                            }
                        }

                        try { if (fs.existsSync(mosaicPath)) fs.unlinkSync(mosaicPath); } catch (e) { }
                        for (const p of framePaths) {
                            if (p && p !== selectedFramePath && fs.existsSync(p)) {
                                try { fs.unlinkSync(p); } catch (e) { }
                            }
                        }
                    } catch (error) {
                        console.error(`[Friend] Mosaic Search failed for "${friend.name}", falling back to simple extraction:`, error);
                        avatarMeta.mode = 'error_fallback';
                        try {
                            const framePath = await extractFrame(videoPath, timestamp, config.uploadDir, 'friend_raw');
                            if (framePath && friend.box) {
                                const croppedPath = await cropImageWithBox(framePath, friend.box, config.uploadDir, 'friend');
                                const fObjPath6a = await uploadFrameAsset(sessionId, 'friend', croppedPath);
                                if (fObjPath6a) (friend as any).imageObjectPath = fObjPath6a;
                                friend.url = fObjPath6a
                                    ? getSessionFrameAssetUrl(sessionId, fObjPath6a)
                                    : (getFileUrl(croppedPath) || undefined);
                            } else if (framePath) {
                                const fObjPath6b = await uploadFrameAsset(sessionId, 'friend', framePath);
                                if (fObjPath6b) (friend as any).imageObjectPath = fObjPath6b;
                                friend.url = fObjPath6b
                                    ? getSessionFrameAssetUrl(sessionId, fObjPath6b)
                                    : (getFileUrl(framePath) || undefined);
                            }
                        } catch (fallbackError) {
                            console.error(`[Friend] Fallback extraction also failed for "${friend.name}":`, fallbackError);
                        }
                    }

                    (friend as any).avatarMeta = avatarMeta;
                    (friend as any).originalTimestamp = friend.timestamp;
                    friend.timestamp = mapToHighlightTime(friend.timestamp, highlights);
                    (friend as any).isMapped = true;

                    if (friend.timestamps && Array.isArray(friend.timestamps)) {
                        friend.timestamps = friend.timestamps.map((ts: { time: string; duration?: number }) => ({
                            ...ts,
                            originalTime: ts.time,
                            time: mapToHighlightTime(ts.time, highlights)
                        }));
                    }
                });
                logStage(`Friend Frame Extraction (Mosaic Search, ${analysisData.friends.length} friends)`, friendStart);

                // Stage 6: Scene Frame Extraction (concurrency limited)
                const sceneStart = Date.now();
                await runWithConcurrencyLimit(analysisData.scenery, 2, async (scene) => {
                    if (scene.timestamp) {
                        const imgPath = await extractFrame(videoPath, scene.timestamp, config.uploadDir, 'scene');
                        const sObjPath = await uploadFrameAsset(sessionId, 'scene', imgPath);
                        if (sObjPath) (scene as any).imageObjectPath = sObjPath;
                        scene.url = sObjPath
                            ? getSessionFrameAssetUrl(sessionId, sObjPath)
                            : (getFileUrl(imgPath) || undefined);
                        (scene as any).originalTime = scene.timestamp;
                        scene.timestamp = mapToHighlightTime(scene.timestamp, highlights);
                    }
                });
                logStage(`Scene Frame Extraction (${analysisData.scenery.length} scenes)`, sceneStart);

                // Stage 7: Dietary Habits Frame Extraction (concurrency limited)
                const dietaryStart = Date.now();
                if (analysisData.dietaryHabits) {
                    await runWithConcurrencyLimit(analysisData.dietaryHabits, 2, async (habit) => {
                        if (habit.timestamp) {
                            const imgPath = await extractFrame(videoPath, habit.timestamp, config.uploadDir, 'food');
                            const dObjPath = await uploadFrameAsset(sessionId, 'food', imgPath);
                            if (dObjPath) (habit as any).imageObjectPath = dObjPath;
                            habit.url = dObjPath
                                ? getSessionFrameAssetUrl(sessionId, dObjPath)
                                : (getFileUrl(imgPath) || undefined);
                            (habit as any).originalTime = habit.timestamp;
                            habit.timestamp = mapToHighlightTime(habit.timestamp, highlights);
                        }
                    });
                }
                logStage(`Dietary Habits Frame Extraction (${analysisData.dietaryHabits?.length || 0} items)`, dietaryStart);

                // Stage 8: Cover Frame Extraction
                const coverStart = Date.now();
                const coverTs = analysisData.coverTimestamp || analysisData.scenery?.[0]?.timestamp || '0:05';
                try {
                    coverPath = await extractFrame(videoPath, coverTs, config.uploadDir, 'cover') || undefined;
                    coverUrl = coverPath ? (getFileUrl(coverPath) || undefined) : undefined;
                    if (coverPath) {
                        coverObjectPath = await uploadGeneratedAsset(sessionId, 'cover', coverPath);
                        if (coverObjectPath) {
                            coverUrl = getSessionCoverAssetUrl(sessionId);
                        }
                    }
                    console.log(`[Cover] Extracted cover frame at ${coverTs}`);
                } catch (e) {
                    console.warn(`[Cover] Failed to extract cover frame:`, e);
                }
                logStage('Cover Frame Extraction', coverStart);
            })()
        ]);

        // Destructure highlight results from Task A
        const { highlightPath, highlightUrl: _highlightUrl, highlightError: _highlightError, highlightObjectPath } = highlightResult;
        let highlightError = _highlightError;
        let highlightUrl = _highlightUrl;

        logStage('Parallel Stages (Highlight Gen + Frame Extraction)', parallelStart);
        updateProgress('Finalizing', 90, 4);

        // Stage 9: Timestamp Mapping (preserve originals + derive highlight-only arrays)
        stageStart = Date.now();

        // Timeline: keep full original timeline for Original mode
        // and derive highlight-mapped timeline for Highlight mode.
        if (analysisData.timeline) {
            const originalCount = analysisData.timeline.length;
            analysisData.timelineHighlight = mapAndFilterForHighlight(
                analysisData.timeline,
                'time',
                'originalTime',
                highlights
            );
            console.log(`[Timeline] Highlight-mapped: ${originalCount} → ${analysisData.timelineHighlight.length} entries`);
        }

        // MoodData: keep full curve for Original mode
        // and derive highlight-mapped mood points for Highlight mode.
        if (analysisData.moodData) {
            const originalCount = analysisData.moodData.length;
            analysisData.moodDataHighlight = mapAndFilterForHighlight(
                analysisData.moodData,
                'name',
                'originalTime',
                highlights
            );
            console.log(`[MoodData] Highlight-mapped: ${originalCount} → ${analysisData.moodDataHighlight.length} entries`);
        }

        // NarrativeSegments: keep ALL segments but mark which ones are in highlight
        // This allows original video to show all subtitles, highlight video to show only matching ones
        if (analysisData.narrativeSegments) {
            let inHighlightCount = 0;
            analysisData.narrativeSegments = analysisData.narrativeSegments.map(seg => {
                const mappedTime = mapToHighlightTime(seg.timestamp, highlights);
                const inHighlight = mappedTime !== null;
                if (inHighlight) inHighlightCount++;

                return {
                    ...seg,
                    originalTime: seg.timestamp,  // Always keep original time for original video playback
                    timestamp: mappedTime || seg.timestamp,  // Use mapped time if available, else keep original
                    inHighlight: inHighlight,  // Flag to indicate if this segment is in highlight video
                    isMapped: true
                };
            });
            console.log(`[Narrative] Total: ${analysisData.narrativeSegments.length}, In highlight: ${inHighlightCount}`);
        }

        logStage('Timestamp Mapping', stageStart);

        // Log total processing time breakdown
        const totalProcessingTime = (Date.now() - totalStart) / 1000;
        console.log(`\n========== Processing Time Summary ==========`);
        console.log(`[Timing] Total Processing: ${formatDuration(totalProcessingTime)}`);
        console.log(`\nStage Breakdown:`);
        stageTimes.forEach((st, i) => {
            const percentage = ((st.duration / totalProcessingTime) * 100).toFixed(1);
            console.log(`  ${i + 1}. ${st.stage}: ${formatDuration(st.duration)} (${percentage}%)`);
        });
        console.log(`==============================================\n`);

        const completedAt = Date.now();
        const processingTime = Math.round((completedAt - sessions[sessionId].startedAt) / 1000);
        delete sessions[sessionId].progress;
        sessions[sessionId] = {
            ...sessions[sessionId],
            status: 'ready',
            analysis: analysisData,
            highlightPath: highlightPath,
            highlightObjectPath: highlightObjectPath || null,
            proxyPath: proxyPath,
            originalDuration: videoDuration,
            coverPath: coverPath || null,
            coverObjectPath: coverObjectPath || null,
            coverUrl: coverUrl,
            highlightUrl: highlightUrl,
            highlightError: highlightError || null,
            videoUrl: resolvedInput.publicVideoUrl || getFileUrl(videoPath),
            completedAt: completedAt,
            processingTime: processingTime,
            stageTimes: stageTimes  // Save stage timing data
        };
        await persistSession(sessionId);

        const sampleTarget = resolveSampleTarget(sessions[sessionId]);
        if (sampleTarget) {
            try {
                await promoteSessionToSample(sessions[sessionId], sampleTarget);
                console.log(`[Sample] Promoted session ${sessionId} -> ${sampleTarget.sampleId}`);
            } catch (e) {
                console.error(`[Sample] Failed to promote session ${sessionId}:`, e);
            }
        }

        console.log(`Session ${sessionId} ready with mapped timestamps. Processing time: ${processingTime}s`);
    } catch (error) {
        const completedAt = Date.now();
        const processingTime = Math.round((completedAt - sessions[sessionId].startedAt) / 1000);
        sessions[sessionId].status = 'error';
        sessions[sessionId].error = (error as Error).message;
        sessions[sessionId].completedAt = completedAt;
        sessions[sessionId].processingTime = processingTime;
        persistSession(sessionId);
        console.error(`Error processing session ${sessionId}:`, error);
    } finally {
        for (const filePath of cleanupPaths) {
            try {
                if (filePath && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (cleanupError) {
                console.warn(`[Cleanup] Failed to remove temporary input file: ${filePath}`, cleanupError);
            }
        }
    }
}

app.listen(port, () => {
    console.log(`Backend server running at ${publicBaseUrl}`);
});
