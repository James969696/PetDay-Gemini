# Friends 头像误截根因分析与彻底修复方案 (Codex)

## 1. 现象复盘

最新测试中出现两类失败：
- `Snowball`：头像截到第一人称宠物自己的毛/舔手瞬间，没有截到 Snowball。
- `Ginger`：头像截到砖墙，尽管第 2/3/4/5 次出现都有清晰正脸和全身。

这说明问题不是“friend 没被检测到”，而是 **头像选帧链路和裁剪链路在多处发生系统性偏差**。

---

## 2. 全代码 + Prompt 深度审计结论（根本原因）

## R1（确定性代码 bug）：`best_photo_timestamp` 在多 timestamp 分支被“逻辑忽略”

### 代码位置
- `backend/server.ts:2297`
- `backend/processor/videoPreprocessor.ts:101-147`

### 现状
`server.ts` 确实优先取：
```ts
const timestamp = friend.best_photo_timestamp || friend.timestamp;
```
但一旦 `friend.timestamps.length > 1`，`extractMosaicFrames(...)` 进入多 timestamp 分支后，primary 直接取“最长 duration”的 timestamp，**不再使用传入的 `centerTimestamp`**。

### 后果
- 即使 Gemini 返回了正确的 `best_photo_timestamp`，头像抽帧仍会围绕“最长互动时段”而不是“最佳头像时段”展开。
- 对 POV 视频来说，最长互动时段往往是低头靠近/舔爪/追逐，面部并不清晰。

这正好解释 Snowball“刚出现瞬间截到自己毛/舔手”。

---

## R2（确定性代码 bug）：`createMosaic` 重排了帧顺序，`cellIndex -> framePath` 映射失真

### 代码位置
- `backend/processor/videoPreprocessor.ts:174-186`
- `backend/server.ts:2355-2363`

### 现状
`createMosaic()` 先 `filter` 掉无效帧再拼图：
```ts
const validPaths = framePaths.filter(p => p && fs.existsSync(p));
```
这会改变索引位置。Gemini 返回的 `cellIndex` 是针对“重排后的 mosaic”，但 `server.ts` 仍按原始 `framePaths[idx]` 取帧。

### 后果
- 选中的 cell 实际对应的是 A 帧，但后端去裁剪 B 帧（甚至空帧 fallback）。
- 会出现“明明 mosaic 里有正脸，但最后头像是墙/地面”。

这是 Ginger 截到砖墙的高概率主因之一。

---

## R3（高概率质量缺陷）：快速 seek 抽帧偏早，常落在目标入场前

### 代码位置
- `backend/processor/videoPreprocessor.ts:155`
- `backend/processor/videoPreprocessor.ts:78`

### 现状
普遍采用 `-ss` 放在 `-i` 前的快速 seek：
```bash
ffmpeg -ss T -i input -vframes 1 ...
```
对长 GOP 视频会偏到前一个关键帧，尤其“刚出现瞬间”很容易抽到入场前画面。

### 后果
- Snowball 刚出现时，实际抽到前一瞬间（自舔/地面/空场景）。

---

## R4（Prompt 缺陷）：没有强硬排除“第一人称自体部位/背景误选”

### 代码位置
- `backend/processor/videoAnalyzer.ts:426-454` (`detectInMosaic` prompt)

### 现状
虽要求“best clearest view”，但没有明确禁止：
- camera wearer 的毛、爪、鼻口、舌头等前景自体部位
- 只有墙/草地/地面的 cell

### 后果
- 在目标不够清晰时，模型可能把“明显动物纹理（但其实是佩戴相机的本体）”当作 friend。

---

## R5（Prompt 一致性缺陷）：`best_photo_timestamp` 已声明但示例 JSON 未给出

### 代码位置
- `backend/processor/videoAnalyzer.ts:212-220`（字段说明）
- `backend/processor/videoAnalyzer.ts:286-304`（示例 JSON）

### 现状
字段说明里有 `best_photo_timestamp`，但示例结构未包含该字段。

### 后果
- 降低模型稳定输出该字段的概率，削弱 R1 修复效果。

---

## 3. 彻底修复方案（按优先级）

## P0（必须，本次就做）

### P0-1：让 `best_photo_timestamp` 真正生效（修 R1）

文件：`backend/processor/videoPreprocessor.ts`

改法：在多 timestamp 分支中，把 primary 选取改为“离 `centerTimestamp` 最近的 timestamp”，而不是固定“最长 duration”。

建议逻辑：
1. `targetSec = timeToSeconds(centerTimestamp)`
2. 在 `allTimestamps` 中找与 `targetSec` 最近者作为 `primary`
3. 其余 timestamp 再按 duration 排序填充

这样 `best_photo_timestamp` 才是实际头像锚点。

---

### P0-2：修复 mosaic 索引映射失真（修 R2）

文件：
- `backend/processor/videoPreprocessor.ts`
- `backend/server.ts`

改法（推荐最小侵入）：
1. 在 server 侧先构造 `mosaicFramePaths`（长度固定 9，保留原索引，不允许重排）。
2. 对缺失帧按索引位填充 fallback（不改变索引，仅替换该位内容）。
3. `createMosaic` 直接按这 9 个路径顺序拼图，不再 `filter` 重排。
4. `cellIndex-1` 始终对应 `mosaicFramePaths[idx]`。

关键点：**宁可补帧，也不能重排**。

---

### P0-3：提升抽帧时间精度（修 R3）

文件：`backend/processor/videoPreprocessor.ts`

把关键抽帧命令改为“快速定位 + 精准二次 seek”：
```bash
ffmpeg -ss (T-1) -i input -ss 1 -frames:v 1 ...
```
或对头像链路使用 `-ss` 在 `-i` 后的准确 seek。

目标：避免“刚出现”被抽成“出现前”。

---

### P0-4：加强 `detectInMosaic` Prompt 反误选约束（修 R4）

文件：`backend/processor/videoAnalyzer.ts`（`detectInMosaic` prompt）

新增硬规则：
- If a cell only shows camera-wearer body parts (paw/fur/muzzle/tongue/whiskers), treat as invalid.
- If a cell only shows wall/ground/grass/sky without target friend, treat as invalid.
- If no valid friend face/head cell exists, return `{cellIndex:null, box:null, confidence:0}`.

---

### P0-5：补齐示例 JSON 中 `best_photo_timestamp`（修 R5）

文件：`backend/processor/videoAnalyzer.ts`

在示例 friend 对象中加入 `best_photo_timestamp`，提高模型结构遵循率。

---

## P1（可选增强）

### P1-1：confidence 策略细化

当前 `CONFIDENCE_FLOOR=25` 太保守，仅能挡住极差结果。  
在 `avatarMeta` 数据积累后，按真实分布再调阈值（例如区分 primary/non-primary）。

### P1-2：窗口策略微调

若 P0 后仍有漏抓，再调窗口（例如 secondary ±0.3 -> ±0.8），保持总帧数不变。

---

## 4. 验收标准（必须全部通过）

1. Snowball：Friends 头像不再出现“自体毛/舔手”误截。  
2. Ginger：Friends 头像不再出现砖墙，且与可见正脸时段一致。  
3. 同视频重复 3 次，头像稳定性明显提升。  
4. Stage 5 与总处理时长无明显回退（允许轻微抖动）。  
5. `avatarMeta` 能解释每次选帧来源（index/time/confidence/mode）。

---

## 5. 回归清单

1. 上传含 Snowball/Ginger 多次出现的测试视频。  
2. 检查每个 friend 的：`timestamp`、`best_photo_timestamp`、`avatarMeta`。  
3. 对照 `selectedFrameIndex` 与实际 mosaic cell 内容是否一致。  
4. 检查“刚出现瞬间”是否仍被抽到入场前帧。  
5. 比较修复前后：Friends 命中率 + 处理耗时。

---

## 6. 关键结论

这次问题不是单点 bug，而是**“timestamp 锚点失效 + mosaic 索引失真 + 抽帧偏早 + prompt 反误选不足”**叠加导致。  
优先修 P0-1/2/3/4/5 后，Snowball 与 Ginger 这类错截会从根上下降。
