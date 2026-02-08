# PetDay 朋友头像终极修复方案 (Gemini v2 - Ginger & Snowball Edition)

> **最新故障**:
> 1. **Ginger (Brick Wall)**: 出现 4 次正脸，但头像截到砖墙/枯草。
> 2. **Snowball (Licking Hand)**: 封面正脸清晰，但头像截到“第一人称舔爪子”。

---

## 1. 根因深度复盘

### Ginger (Brick Wall) -> **Coordinate Hallucination (坐标系幻觉)**
*   **证据**: `server.ts` 中已经包含了 "Primary Index Fallback" 的修复逻辑 (Index 1 vs 4)，但 Ginger 依然出错。这证明 **“选错帧”不是主要原因**，或者至少不是唯一原因。
*   **真凶**: `videoAnalyzer.ts` 目前的代码**无条件**执行 `(y - cell_offset)`。
    *   当 Gemini 对于 Cell 9 (或任何非左上角 Cell) 返回了 **相对坐标** (e.g., 500) 时。
    *   代码计算 `500 - 666 = -166` -> Clamp to 0。
    *   **结果**: 截取 Cell 的左上角。对于户外背景，这通常是墙、草或天空。
*   **结论**: 必须实施 **自适应坐标解码 (Adaptive Coordinate Decoding)**。

### Snowball (Licking Hand) -> **Prompt Weakness (提示词疲软)**
*   **证据**: 代码已经优先使用了 `best_photo_timestamp`。
*   **真凶**: Gemini 虽然被要求找 "Face/Head"，但在 POV 视频中，它容易把 "Self-Grooming" (舔爪子) 或 "Sniffing" (低头闻) 误判为高清晰度的互动瞬间。
*   **结论**: 必须在 Prompt 中 **显式禁止 (Negative Constraint)** 第一人称视角的肢体部位（爪子、身体）作为头像。

---

## 2. 修复方案实施

### Fix 1: 自适应坐标解码 (`backend/processor/videoAnalyzer.ts`)
**目标**: 彻底修复 Ginger 的砖墙问题。

在 `detectInMosaic` 函数中，解析出 Box 后，增加智能判断：

```typescript
// 计算当前 Cell 的绝对起始坐标
const cellRow = Math.floor((cellIndex - 1) / 3);
const cellCol = (cellIndex - 1) % 3;
const cellSize = 1000 / 3;
const cellAbsMinY = cellRow * cellSize;
const cellAbsMinX = cellCol * cellSize;

let [ymin, xmin, ymax, xmax] = parsed.box;

// --- 自适应逻辑开始 ---
// 如果返回的坐标远小于 Cell 的起始位置 (说明它是 0-1000 的相对坐标)
// 阈值设为 cellAbsMinY - 100 (留出 buffer 防止轻微漂移)
if (ymin < cellAbsMinY - 100 && cellRow > 0) {
    // 判定为相对坐标：直接 clamp，不减 offset
    ymin = Math.max(0, Math.min(1000, ymin));
    ymax = Math.max(0, Math.min(1000, ymax));
} else {
    // 判定为绝对坐标：执行标准转换
    ymin = Math.max(0, Math.min(1000, ((ymin - cellAbsMinY) / cellSize) * 1000));
    ymax = Math.max(0, Math.min(1000, ((ymax - cellAbsMinY) / cellSize) * 1000));
}

// X 轴同理
if (xmin < cellAbsMinX - 100 && cellCol > 0) {
    xmin = Math.max(0, Math.min(1000, xmin));
    xmax = Math.max(0, Math.min(1000, xmax));
} else {
    xmin = Math.max(0, Math.min(1000, ((xmin - cellAbsMinX) / cellSize) * 1000));
    xmax = Math.max(0, Math.min(1000, ((xmax - cellAbsMinX) / cellSize) * 1000));
}
// --- 自适应逻辑结束 ---
```

### Fix 2: Prompt 负向约束增强 (`backend/processor/videoAnalyzer.ts`)
**目标**: 彻底修复 Snowball 的舔爪子问题。

更新 `analyzeVideo` 中的 Prompt，针对 `best_photo_timestamp`：

```text
- best_photo_timestamp: The absolute BEST moment for a portrait/avatar photo.
  CRITICAL RULES:
  1. MUST be the other animal's face, looking towards the camera (eye contact is best).
  2. STRICTLY EXCLUDE: Moments where the POV pet is looking at its own paws, legs, or body (self-grooming).
  3. STRICTLY EXCLUDE: Moments where the camera is touching the other animal (extreme close-up/sniffing).
  4. If the exact timestamp of peak interaction is blurry/too close, shift 0.5-1.0s backward or forward to find a stable frame.
```

---

## 3. 验证清单

1.  **代码审查**: 确认 `detectInMosaic` 中加入了上述 `if (ymin < ...)` 逻辑。
2.  **代码审查**: 确认 Prompt 中加入了 `STRICTLY EXCLUDE` 规则。
3.  **回归测试**:
    *   **Ginger**: 重新分析，确认头像不再是砖墙。
    *   **Snowball**: 重新分析，确认头像不再是爪子。

此方案在不增加 API 耗时、不改变架构的前提下，精准打击了两个最新的失效模式。
