# PetDay Friends 头像截图质量问题 — 根因诊断与修复 (Claude v11)

> **现象**: Snowball 截到宠物自己舔手的毛，Ginger 截到砖墙。封面图正确。
> **约束**: 完整修复，不增加分析时长。

---

## 1. Cloud Run 日志实证（2026-02-08 最新测试）

### Snowball (Siamese Cat)

```
[Friend] Mosaic Search for "Snowball" (Siamese Cat) at 01:35
[Mosaic] Multi-timestamp extraction for friend-Snowball:
    sources=[01:30(22s), 02:17(18s), 00:58(6s), 05:19(6s), 00:36(5s), 04:32(4s)]
[Mosaic] Frame timestamps: 89.5, 90.0, 90.5, 136.7, 137.3, 57.7, 58.3, 318.7, 319.3

[Mosaic Detection] No clear animal found in mosaic for Siamese Cat
    (pure white coat, odd eyes (heterochromia), slender build)
[Friend] No clear detection for "Snowball", using primary fallback
[Crop] Cropping friend-Snowball-mosaic-1-ykh2y.jpg
    with box [300,350,980,650] -> 691x700+294+20
```

**解读**:
- `at 01:35` — `best_photo_timestamp` 或 `friend.timestamp` 是 01:35
- 但 `extractMosaicFrames` 按 duration 排序，primary = `01:30(22s)`
- 9 帧来自: 01:29.5~01:30.5 (primary) + 02:16.7~02:17.3 + 00:57.7~00:58.3 + 05:18.7~05:19.3
- **Gemini 在 9 帧中完全找不到 Snowball** → 返回 null
- Fallback 用 primary 帧 (01:30.0) + `friend.box` → 截到宠物舔手的毛

**关键**: `01:30` 是 Snowball 的最长出现时段（22s），但此时 POV 相机正在拍宠物自己 — 宠物在 Snowball 旁边舔自己的手。而封面使用的 `coverTimestamp` 约 `01:35`（"Captivating close-up of Snowball's unique odd eyes"），相差仅 5 秒但画面完全不同。

### Ginger (Orange Tabby)

```
[Friend] Mosaic Search for "Ginger" (Orange Tabby) at 02:08
[Mosaic] Multi-timestamp extraction for friend-Ginger:
    sources=[00:14(7s), 02:06(6s), 03:26(6s), 04:41(6s), 01:17(4s)]
[Mosaic] Frame timestamps: 13.5, 14.0, 14.5, 125.7, 126.3, 205.7, 206.3, 280.7, 281.3

[Mosaic Detection] Error detecting Orange Tabby in mosaic:
    Error: Gemini detectInMosaic timed out after 45s
[Friend] No clear detection for "Ginger", using primary fallback
[Crop] Cropping friend-Ginger-mosaic-1-0pvxj.jpg
    with box [20,450,280,780] -> 760x276+407+0
```

**解读**:
- Primary = `00:14(7s)` — 最长出现时段，但此时是砖墙画面
- 用户说第 2/3/4/5 次出现有清晰正脸，但这些在 ±0.3s 的窄窗口中
- Gemini 超时 → Fallback 用 primary 帧 (00:14.0) + `friend.box` → 截到砖墙

### Mochi (Tabby Cat) — 对照组，成功

```
[Friend] "Mochi" → cell 9, confidence 90%
```
Mochi 成功是因为其最长出现时段恰好有清晰面部。

---

## 2. 真正的根因（之前所有方案都未发现）

### 根因 1: `extractMosaicFrames` 在多 timestamp 模式下完全忽略 `best_photo_timestamp`

**文件**: `backend/processor/videoPreprocessor.ts:107-114`

```typescript
// server.ts:2297 传入的 centerTimestamp = best_photo_timestamp || friend.timestamp
// 例如 Snowball 的 best_photo_timestamp = "01:35"

export async function extractMosaicFrames(
    videoPath: string,
    centerTimestamp: string,   // ← "01:35" 传进来了
    ...
    alternativeTimestamps?: { time: string; duration?: number }[]
) {
    if (!alternativeTimestamps || alternativeTimestamps.length <= 1) {
        // 单 timestamp 模式: 用 centerTimestamp ✓
        const baseSec = timeToSeconds(centerTimestamp);
    } else {
        // 多 timestamp 模式: 完全忽略 centerTimestamp ✗
        const allTimestamps = alternativeTimestamps
            .sort((a, b) => b.duration - a.duration);  // 按时长排序
        const primary = allTimestamps[0];  // 最长时段 = 01:30(22s)，不是 01:35！
    }
}
```

**`best_photo_timestamp = "01:35"` 被传入但被完全忽略。** Primary 始终是 duration 最长的出现，而非面部最清晰的时刻。

这就是 Fix 4（添加 `best_photo_timestamp` 到 prompt）没有生效的原因 — 即使 Gemini 返回了正确的值，`extractMosaicFrames` 在多 timestamp 模式下根本不看它。

### 根因 2: 9 帧中可能完全没有 friend 的清晰面部

对 Snowball:
- Primary 3 帧 (01:29.5, 01:30.0, 01:30.5): 宠物在舔自己的手 → 没有 Snowball 正脸
- Secondary 2 帧 (02:16.7, 02:17.3): 02:17 附近，仅 ±0.3s → 可能也看不到正脸
- Tertiary + Padding: 同理

**结果**: Gemini 在 9 帧中完全找不到 Snowball → 返回 null → 走 fallback → 截到宠物自己的毛

### 根因 3: ±0.3s 的 secondary 窗口太窄

对于 POV 相机，0.6s 的窗口内视角可能不变（一直朝下/朝墙）。Ginger 的 4 次正脸出现(02:06, 03:26, 04:41, 01:17) 各只有 ±0.3s = 0.6s 窗口，可能全部错过正脸瞬间。

### 根因 4 (次要): `createMosaic` 的索引错位风险

**文件**: `backend/processor/videoPreprocessor.ts:174-183`

```typescript
const validPaths = framePaths.filter(p => p && fs.existsSync(p));
// 如果 framePaths[2] 提取失败 = ''
// validPaths = [frame0, frame1, frame3, frame4, ...] ← 索引偏移!
// 但 mosaic cell 3 对应 validPaths[2] = frame3
// 而 server.ts 做: framePaths[cellIndex-1] = framePaths[2] = '' ← 错位!
```

这在帧提取失败时会导致 mosaic cell 和 framePaths 索引不匹配。当前测试中未触发（所有帧提取成功），但是潜在 bug。

---

## 3. 为什么之前的 Fix 1-5 没有解决问题

| Fix | 设计目标 | 实际效果 |
|-----|----------|----------|
| Fix 1: Primary fallback index | fallback 时选正确帧 | **无效** — Snowball 的 primary 帧 (01:30) 本身就是错的（宠物舔手），换 index 1 还是同一时段 |
| Fix 2: Crop safety | 防跨 timestamp box 错位 | **无效** — 用的就是 primary 帧 + primary box，没有跨 timestamp |
| Fix 3: Confidence floor 25 | 拦截低置信度选择 | **无效** — Gemini 返回 null（没有选择），不是低置信度 |
| Fix 4: best_photo_timestamp | 用面部清晰时刻 | **无效** — `extractMosaicFrames` 多 timestamp 模式忽略它 |
| Fix 5: avatarMeta | 可观测性 | 有用但不解决问题 |

**核心问题**: 之前所有方案都假设"9 帧中至少有几帧包含 friend 的面部"，但实际上 **9 帧可能全部不含 friend 的面部**。问题出在帧选择策略（按 duration 排序 + 窄窗口），不在 fallback 逻辑。

---

## 4. 完整修复方案

### Fix A: 让 `best_photo_timestamp` 成为多 timestamp 模式的 primary（核心修复）

**文件**: `backend/processor/videoPreprocessor.ts:107-124`

**问题**: `centerTimestamp`（= `best_photo_timestamp`）在多 timestamp 模式下被完全忽略。

**修复**: 如果 `centerTimestamp` 与 duration 排序的 primary 不同，将其作为真正的 primary。

```typescript
} else {
    const allTimestamps = alternativeTimestamps.map(t => ({
        time: t.time,
        seconds: timeToSeconds(t.time),
        duration: t.duration || 0
    })).sort((a, b) => b.duration - a.duration);

    frameTimestamps = [];

    // 如果 centerTimestamp（best_photo_timestamp）与 duration primary 不同，
    // 优先用 centerTimestamp 作为 primary
    const centerSec = timeToSeconds(centerTimestamp);
    const durationPrimary = allTimestamps[0];
    const useBestPhoto = Math.abs(centerSec - durationPrimary.seconds) > 1.0;

    const primarySec = useBestPhoto ? centerSec : durationPrimary.seconds;

    // Primary: 5 帧覆盖 ±1.5s（从 3 帧扩大，提高面部捕获概率）
    frameTimestamps.push(
        Math.max(0, primarySec - 1.5),
        Math.max(0, primarySec - 0.5),
        primarySec,
        Math.max(0, primarySec + 0.5),
        Math.max(0, primarySec + 1.5)
    );

    // Secondary: 剩余 timestamp 各 1 帧（从 2 帧减少，但总帧数仍为 9）
    for (let i = 0; i < allTimestamps.length && frameTimestamps.length < 9; i++) {
        const ts = allTimestamps[i];
        // 跳过已作为 primary 的 timestamp
        if (Math.abs(ts.seconds - primarySec) < 2.0) continue;
        frameTimestamps.push(ts.seconds);
    }

    // Padding
    const paddingOffsets = [-2.5, 2.5, -3.5, 3.5];
    let paddingIdx = 0;
    while (frameTimestamps.length < 9 && paddingIdx < paddingOffsets.length) {
        frameTimestamps.push(Math.max(0, primarySec + paddingOffsets[paddingIdx]));
        paddingIdx++;
    }
}
```

**效果**:
- Snowball: primary 从 01:30 变为 01:35（`best_photo_timestamp`），5 帧覆盖 01:33.5~01:36.5 → 捕获到 Snowball 正脸（封面就在这个时段）
- Ginger: 如果 `best_photo_timestamp` 指向 02:06 等正脸时段，primary 从 00:14（砖墙）变为正脸时段
- 仍然 9 帧，0 额外开销

### Fix B: `createMosaic` 索引对齐修复

**文件**: `backend/processor/videoPreprocessor.ts:170-183`

**问题**: `framePaths.filter()` 过滤空路径后，`validPaths` 索引与 `framePaths` 不对齐。Gemini 返回的 cellIndex 映射到 validPaths，但 server.ts 用 cellIndex 索引 framePaths。

**修复**: 不 filter，而是就地替换空路径。

```typescript
export async function createMosaic(
    framePaths: string[],
    outputPath: string
): Promise<string> {
    // 就地替换空/缺失帧，保持索引对齐
    const firstValid = framePaths.find(p => p && fs.existsSync(p)) || '';
    const mosaicPaths = framePaths.map(p =>
        (p && fs.existsSync(p)) ? p : firstValid
    );

    if (!firstValid) {
        throw new Error('[Mosaic] No valid frames available for mosaic creation');
    }

    // 确保恰好 9 帧
    while (mosaicPaths.length < 9) mosaicPaths.push(firstValid);

    const inputs = mosaicPaths.slice(0, 9).map(p => `-i "${p}"`).join(' ');
    const command = `ffmpeg -y ${inputs} -filter_complex "..." -q:v 2 "${outputPath}"`;
    // ...
}
```

**效果**: mosaic cell N 始终对应 `framePaths[N-1]`，消除索引错位。

### Fix C: 更新 `primaryIdx` 计算以匹配 Fix A 的新布局

**文件**: `backend/server.ts:2325-2332`

Fix A 改变了帧布局（primary 5 帧，secondary 各 1 帧），需要更新 primaryIdx。

```typescript
// Fix A 后的新布局:
// 多 timestamp: index 0-4 是 primary（5 帧），index 2 是 center
// 单 timestamp: index 4 是 center（原始 ±2s window）
const isMultiTimestamp = !!(friend.timestamps && friend.timestamps.length > 1);
const primaryIdx = isMultiTimestamp ? 2 : 4;
```

### Fix D: 保留之前的 Fix 3 (confidence floor) + Fix 5 (avatarMeta)

这些已经部署了，继续保留。

---

## 5. 修改文件清单

| # | 文件 | 修改内容 | 风险 |
|---|------|----------|------|
| 1 | `videoPreprocessor.ts:107-147` | Fix A: `best_photo_timestamp` 作为多 timestamp 模式的 primary + 扩大 primary 窗口至 ±1.5s | 低 — 改帧选择逻辑，不改 API 调用 |
| 2 | `videoPreprocessor.ts:170-183` | Fix B: `createMosaic` 索引对齐 | 低 — 用 map 替代 filter |
| 3 | `server.ts:2328-2329` | Fix C: 更新 `primaryIdx` (1 → 2) | 极低 — 一行改动 |

**总计: 2 个文件，0 额外 API 调用，0 额外 FFmpeg 步骤，仍然 9 帧。**

---

## 6. 预期效果

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| Snowball: best_photo=01:35, duration_primary=01:30 | primary=01:30（宠物舔手）→ 9 帧无正脸 → 截毛 | primary=01:35（best_photo）→ 5 帧覆盖 01:33.5~01:36.5 → 捕获正脸 |
| Ginger: best_photo=02:08, duration_primary=00:14 | primary=00:14（砖墙）→ 超时 → 截砖墙 | primary=02:08（best_photo）→ 5 帧覆盖 02:06.5~02:09.5 → 捕获正脸 |
| 帧提取失败导致索引错位 | mosaic cell 与 framePaths 不匹配 | 就地替换保持对齐 |

---

## 7. 验证方法

1. 用 Tom/Jackson 视频重新分析
2. 检查日志:
   - `[Mosaic] Frame timestamps` 中 primary 应为 `best_photo_timestamp` 而非 duration 最长的时段
   - `[Mosaic Detection]` 应找到动物（不再是 "No clear animal found"）
3. 检查 `avatarMeta`:
   - `mode` 应为 `mosaic_selected`（非 fallback）
   - `timestampUsed` 应为 `best_photo_timestamp` 值
4. Snowball 头像显示白猫正脸，Ginger 头像显示橘猫正脸
