# PetDay — AI Pet POV Video Insights (Hackathon Story)

## Inspiration

Have you ever wondered what your dog or cat *really* does when you're not looking? We strapped a GoPro to our pets' collars full of excitement, hoping for a "Secret Life of Pets" movie. Instead, we got 2 hours of nauseatingly shaky footage, 45 minutes of staring at a wall, and endless shots of grass.

**The realization:** Raw POV footage is unwatchable for humans, but it's a goldmine of data for AI. We didn't want to watch the footage; we wanted *insights*. We wanted to know: "Did he make any friends?", "Was he happy at the park?", "Did he eat something he shouldn't have?". Thus, **PetDay** was born—an AI analyst that watches the boring parts so you don't have to, turning raw chaos into a structured, heartwarming daily report.

## What it does

PetDay transforms raw, hours-long POV video into a comprehensive **"Pet Diary"** and **"Highlight Reel"**:

1.  **AI-Generated Diary**: Writes a first-person narrative journal entry *as the pet* (e.g., "Use a warm, curious tone: 'Ooh! That squirrel is back!'").
2.  **Smart Highlight Reel**: Automatically identifies and cuts the best 60 seconds of action, social interaction, and scenic views, discarding the shakiness.
3.  **"Friends" Detection**: Identifies every animal the pet meets (e.g., "Golden Retriever", "Siamese Cat"), logs the timestamp, and assesses the relationship status ("Bestie" vs "Rival").
4.  **Safety & Health Alerts**: Flags dangerous behavior (eating unknown objects, high jumps, aggression) without human review.
5.  **Aesthetic Scenery Capture**: Detects moments of "Visual Appreciation" (when the pet stops to look at a sunset or landscape) and saves them as "Zen Moments".

## How we built it

We built a modern, scalable pipeline using **Google Gemini 3 Flash** as the core intelligence engine.

-   **Frontend**: A responsive **React** dashboard (Next.js) visualized with **Recharts** for mood tracking.
-   **Backend**: A **Node.js** processing pipeline deployed on **Google Cloud Run**.
-   **Core AI (The "Brain")**:
    -   **Gemini 3 Flash**: We utilize its massive 1M+ token context window to feed *entire* video chapters for semantic understanding.
    -   **Multimodal Logic**: We don't just extract frames; we send video chunks directly to Gemini to understand *temporal context* (e.g., "Is the dog running *towards* the owner or *away*?").
    -   **Prompt Engineering**: We designed a complex prompt architecture that forces Gemini to act as a "Video Editor", outputting precise timestamps (MM:SS) for cuts, scoring clips on "Cuteness," "Action," and "Story."
-   **Video Processing**: **FFmpeg** is used for:
    -   **Smart Mosaics**: We create 3x3 grid "mosaics" of candidate frames to let Gemini select the best "Profile Picture" for identified friends in a single API call (reducing costs by 9x).
    -   **Lossless Trimming**: High-speed stream copying to generate the Highlight Reel without re-encoding.

## Challenges we ran into

### 1. The "Snowball & Ginger" Conundrum (Hallucinations)
We faced a bizarre issue where our "Friend" avatars were cropping the wrong things.
-   **Ginger (The Cat)**: Gemini identified the cat perfectly in a 3x3 grid but returned coordinates that cropped a **brick wall** in the final image.
    -   *Solution*: We discovered Gemini was "hallucinating" the coordinate system (returning 0-1000 relative to the *cell* instead of the *image*). We wrote an "Adaptive Coordinate Decoding" algorithm to detect and fix this mathematically.
-   **Snowball (The Licker)**: The AI kept selecting frames where the pet was licking its own paw as a "Friend Portrait."
    -   *Solution*: We had to harden our prompts with **Negative Constraints** ("STRICTLY EXCLUDE self-grooming or first-person body parts"), teaching the AI that "looking at myself" != "looking at a friend."

### 2. The "Shaky Cam" Problem
Pet POV video is incredibly unstable. Traditional Computer Vision (OpenCV) failed to track objects reliably.
-   *Solution*: Gemini's multimodal video understanding was a game-changer. It understood *semantic* stability (e.g., "The dog is looking at the horizon") even when the pixel data was chaotic, allowing us to identify "Scenery" moments that traditional algorithms missed.

## Accomplishments that we're proud of

-   **The "One-Click" Editor**: We successfully automated the job of a video editor. The system takes a 1-hour boring video and outputs a compelling 60-second story without *any* human intervention.
-   **Personality Injection**: The "AI Note" isn't just a summary; it captures the *personality* of the pet. It's funny, emotional, and feels alive.
-   **Zero-Latency Analysis**: By optimizing our FFmpeg pipeline and using Gemini Flash, we act near real-time relative to upload speed.

## What we learned

-   **Context is King**: Processing video frame-by-frame loses the "story." Feeding larger video chunks to Gemini 3 Flash allowed it to understand *intent* (e.g., "He's waiting for the ball") rather than just objects ("Dog," "Ball").
-   **Prompting Video is Different**: Asking for "timestamps" requires very specific formatting instructions (MM:SS vs seconds), or the model drifts.
-   **Resource Management**: Handling gigabytes of video requires robust stream processing (Node.js Streams) rather than loading everything into RAM.

## What's next for PetDay — AI Pet POV Video Insights

1.  **Health Quantified**: Using the video to count steps, jump heights, and detect limp/gait changes for early vet warnings.
2.  **Social Sharing**: "PetDay Community" — auto-share your Highlight Reel to TikTok/Reels directly from the dashboard.
3.  **Live Interaction**: Integrating with live-streaming cameras to let owners talk to their pets via AI voice based on what the AI sees happening *now*.

---

# 中文翻译 (Chinese Translation)

# PetDay — AI 宠物第一人称视角视频洞察 (黑客松故事)

## 灵感来源 (Inspiration)

你是否想过，当你不在家时，你的猫或狗 *到底* 在做什么？我们兴奋地把 GoPro 绑在宠物的项圈上，期待着拍出一部《爱宠大机密》大片。结果，我们得到的是 2 小时令人头晕目眩的抖动画面，45 分钟对着墙壁的发呆，以及无穷无尽的草地特写。

**我们的顿悟：** 原始的 POV（第一人称视角）素材对人类来说简直没法看，但对 AI 来说却是一个数据金矿。我们不想 *看* 视频；我们要的是 *洞察*。我们想知道：“它交到朋友了吗？”“它在公园开心吗？”“它乱吃东西了吗？”。于是，**PetDay** 诞生了——一个代替你看完枯燥片段的 AI 分析师，将原始的混乱画面转化为结构化、温馨的每日报告。

## 它的功能 (What it does)

PetDay 将数小时长的原始 POV 视频转化为全面的 **“宠物日记”** 和 **“高光时刻”**：

1.  **AI 生成日记**：以 *宠物的第一人称* 撰写叙事日志（例如：“用温暖好奇的语气：‘噢！那只松鼠又来了！’”）。
2.  **智能高光时刻**：自动识别并剪辑出 60 秒的最佳动作、社交互动和风景画面，剔除抖动片段。
3.  **“朋友”检测**：识别宠物遇到的每一种动物（如“金毛寻回犬”、“暹罗猫”），记录时间戳，并评估关系状态（“死党” vs “死对头”）。
4.  **安全与健康警报**：无需人工审核即可标记危险行为（误食异物、高处跳跃、攻击性行为）。
5.  **美学风景捕捉**：检测“视觉欣赏”时刻（当宠物停下来看日落或风景时），并将其保存为“禅意时刻 (Zen Moments)”。

## 构建方法 (How we built it)

我们使用 **Google Gemini 3 Flash** 作为核心智能引擎，构建了一个现代化的可扩展管道。

-   **前端**：反应灵敏的 **React** 仪表盘 (Next.js)，使用 **Recharts** 进行情绪可视化。
-   **后端**：部署在 **Google Cloud Run** 上的 **Node.js** 处理管道。
-   **核心 AI (“大脑”)**：
    -   **Gemini 3 Flash**：利用其庞大的 1M+ Token 上下文窗口，我们将 *整个* 视频章节输入进去以进行语义理解。
    -   **多模态逻辑**：我们不仅是提取帧；我们还将视频块直接发送给 Gemini 以理解 *时间上下文*（例如，“这只狗是 *跑向* 主人还是 *跑离* 主人？”）。
    -   **提示工程 (Prompt Engineering)**：我们设计了一个复杂的提示架构，迫使 Gemini 充当“视频剪辑师”，输出精确的剪辑时间戳 (MM:SS)，并在“可爱度”、“动作”和“故事性”方面对片段进行评分。
-   **视频处理**：使用 **FFmpeg** 进行：
    -   **智能拼接 (Smart Mosaics)**：我们创建候选帧的 3x3 网格“拼接图”，让 Gemini 通过一次 API 调用就为识别出的朋友选出最佳“个人资料照片”（成本降低 9 倍）。
    -   **无损剪裁**：通过高速流复制生成高光时刻，无需重新编码。

## 遇到的挑战 (Challenges we ran into)

### 1. “Snowball & Ginger” 难题 (幻觉)
我们遇到了一个离奇的问题，我们的“朋友”头像总是裁剪错误。
-   **Ginger (猫)**：Gemini 在 3x3 网格中完美地识别出了猫，但返回的坐标却在最终图像中裁剪出了一面 **砖墙**。
    -   *解决方案*：我们发现 Gemini 对坐标系产生了“幻觉”（返回的是相对于 *单元格* 而非 *整张图片* 的 0-1000 坐标）。我们编写了一个“自适应坐标解码”算法，通过数学方法检测并修复了这个问题。
-   **Snowball (舔手怪)**：AI 总是选择宠物舔自己爪子的帧作为“朋友肖像”。
    -   *解决方案*：我们必须使用 **负向约束**（“严禁包含自我梳理或第一人称身体部位”）来强化提示词，教 AI 明白“看我自己”不等于“看朋友”。

### 2. “抖动镜头” 问题
宠物 POV 视频极其不稳定。传统的计算机视觉 (OpenCV) 无法可靠地跟踪物体。
-   *解决方案*：Gemini 的多模态视频理解是一个颠覆性的改变。即使像素数据混乱，它也能理解 *语义* 上的稳定性（例如，“狗正在看地平线”），使我们能够识别出传统算法遗漏的“风景”时刻。

## 我们的成就 (Accomplishments that we're proud of)

-   **“一键式”剪辑师**：我们成功自动化了视频剪辑师的工作。系统接收 1 小时的枯燥视频，并输出一个引人入胜的 60 秒故事，无需 *任何* 人工干预。
-   **个性注入**：“AI 笔记”不仅仅是一个总结；它捕捉了宠物的 *个性*。它有趣、感性，感觉栩栩如生。
-   **零延迟分析**：通过优化 FFmpeg 管道并使用 Gemini Flash，我们的处理速度相对于上传速度几乎是实时的。

## 经验教训 (What we learned)

-   **上下文为王 (Context is King)**：逐帧处理视频会丢失“故事性”。向 Gemini 3 Flash 输入更大的视频块，使其能够理解 *意图*（例如，“他在等球”），而不仅仅是物体（“狗”，“球”）。
-   **视频提示词不同**：要求“时间戳”需要非常具体的格式说明（MM:SS vs 秒数），否则模型会发生漂移。
-   **资源管理**：处理数 GB 的视频需要健壮的流处理 (Node.js Streams)，而不是将所有内容加载到 RAM 中。

## PetDay 的下一步 (What's next for PetDay — AI Pet POV Video Insights)

1.  **健康量化**：利用视频计算步数、跳跃高度，并检测跛行/步态变化，以进行早期兽医预警。
2.  **社交分享**：“PetDay 社区”——直接从仪表盘自动分享你的高光时刻到 TikTok/Reels。
3.  **实时互动**：与直播摄像头集成，基于 AI *此时此刻* 看到的内容，让主人通过 AI 语音与宠物交谈。



## Inspiration

Have you ever wondered what your dog or cat *really* does when you're not looking? We strapped a GoPro to our pets' collars full of excitement, hoping for a "Secret Life of Pets" movie. Instead, we got 2 hours of nauseatingly shaky footage, 45 minutes of staring at a wall, and endless shots of grass.

**The realization:** Raw POV footage is unwatchable for humans, but it's a goldmine of data for AI. We didn't want to watch the footage; we wanted *insights*. We wanted to know: "Did he make any friends?", "Was he happy at the park?", "Did he eat something he shouldn't have?". Thus, **PetDay** was born—an AI analyst that watches the boring parts so you don't have to, turning raw chaos into a structured, heartwarming daily report.

## What it does

PetDay transforms raw, hours-long POV video into a comprehensive **"Pet Diary"** and **"Highlight Reel"**:

1.  **AI-Generated Diary**: Writes a first-person narrative journal entry *as the pet* (e.g., "Use a warm, curious tone: 'Ooh! That squirrel is back!'").
2.  **Smart Highlight Reel**: Automatically identifies and cuts the best 60 seconds of action, social interaction, and scenic views, discarding the shakiness.
3.  **"Friends" Detection**: Identifies every animal the pet meets (e.g., "Golden Retriever", "Siamese Cat"), logs the timestamp, and assesses the relationship status ("Bestie" vs "Rival").
4.  **Safety & Health Alerts**: Flags dangerous behavior (eating unknown objects, high jumps, aggression) without human review.
5.  **Aesthetic Scenery Capture**: Detects moments of "Visual Appreciation" (when the pet stops to look at a sunset or landscape) and saves them as "Zen Moments".

## How we built it

**Architecture:**

```
Video Upload → Preprocessing (FFmpeg) → Gemini AI Analysis → Highlight Curation → FFmpeg Compilation → Result Delivery
```

**AI Core**: Gemini 3 Flash processes the entire video in a **single multimodal API call** — analyzing visual frames (~1 fps) and audio simultaneously. One carefully engineered prompt extracts all analysis dimensions (narrative, mood, friends, scenery, safety, timeline, highlight timestamps, dietary habits) as structured JSON in one pass. Supporting Gemini calls handle friend portrait detection via 3×3 frame mosaics.

**Backend**: Express.js + TypeScript on Google Cloud Run. FFmpeg handles all video manipulation — proxy generation, frame extraction, mosaic creation for friend portrait selection, segment trimming, and final highlight compilation.

**Frontend**: React 19 + Vite on Firebase Hosting. Recharts for interactive mood visualization, Framer Motion for animations.

**Cloud Infrastructure**: Google Cloud Storage for video/asset persistence, Firestore for session metadata, Cloud Run for auto-scaling compute.

**Highlight Priority System** — not all moments are equal:

| Priority | Moment Type |
| ----------- | ----------- |
| 100 | Safety-critical moments |
| 95 | Friend + Scenery combinations |
| 85 | Scenery near a friend interaction |
| 80 | Friend encounters |
| 75 | High-quality scenic views |
| 60 | Eating/drinking moments |
| 50 | General scenery |
| 10–30 | Other AI-detected moments |

The system guarantees coverage: every detected friend gets at least one clip, scenery is always represented, and friend+scenery combinations are prioritized as the most emotionally resonant content.

**Friend Portrait Extraction Pipeline** — extracting a clear portrait of another animal from a shaky pet POV camera is surprisingly hard. Our multi-stage pipeline:

1. Gemini identifies all animal friends with timestamps and visual traits
2. Extract a 3×3 mosaic of 9 candidate frames around the best timestamps
3. Gemini analyzes the mosaic to find the clearest cell
4. FFmpeg crops the portrait using bounding box coordinates
5. Multiple fallback layers ensure we always return a usable result

## Challenges we ran into

**POV Camera Is the Worst Camera.** Pet POV footage breaks every assumption of traditional video analysis. The camera is at ground level, shakes constantly, and the most important subjects appear at unpredictable angles. We had to teach Gemini that a blurry shape at the edge of frame might be the pet's best friend — this required extensive prompt engineering with explicit POV-aware constraints.

**The "Best Photo" Paradox.** The moment a pet interacts most closely with a friend is rarely the moment with the clearest photo of that friend (the pet is often too close, looking down, or moving). We had to separate "best interaction timestamp" from "best portrait timestamp" and build a multi-stage mosaic analysis pipeline.

**Structured Output Reliability.** Getting Gemini to consistently return valid JSON with precise timestamps across 30+ minute videos required extensive prompt iteration. We implemented retry logic with exponential backoff, timeout protection at every stage, and graceful degradation.

**Cloud Run Ephemeral Storage.** Processed videos disappeared after redeployment. The fix: all assets persisted to GCS, and Firestore writes must be `await`ed (not fire-and-forget) because Cloud Run instances shut down before async writes complete.

**Balancing Highlight Duration.** A 60-second highlight from a 30-minute video means cutting 97% of footage. The challenge isn't finding good moments — it's choosing *which* good moments to keep.

## Accomplishments that we're proud of

- **Single-Call Comprehensive Analysis**: One Gemini API call extracts narrative, mood curve, friend social graph, scenery highlights, safety alerts, activity timeline, dietary habits, and highlight timestamps simultaneously — no multi-pass processing needed.
- **3-Minute End-to-End Pipeline**: Optimized from an initial 6–7 minutes on Cloud Run through adaptive preprocessing (≤500MB videos skip re-encoding), parallel segment extraction via `Promise.all`, and concurrent final processing steps.
- **Robust Friend Portrait System**: Despite the extreme difficulty of extracting clear animal photos from a shaky POV camera, our mosaic-based pipeline with multi-layer fallbacks reliably produces usable friend portraits.
- **Intelligent Curation, Not Just Detection**: Our highlight reel understands that a quiet moment of a cat and its friend watching a sunset together (priority 95) is more meaningful than a solo run across the yard (priority 30).
- **Production-Ready Cloud Architecture**: The system handles videos from 30 seconds to 60+ minutes, supports resumable uploads for files up to 20GB, auto-scales on Cloud Run, and persists all data reliably across deployments.

## What we learned

- **Gemini's multimodal capabilities are transformative**: Processing an entire video with audio context in a single API call produces far richer analysis than frame-by-frame approaches. The model genuinely understands temporal relationships and emotional context.
- **Prompt engineering is architecture**: The difference between a good prompt and a great prompt isn't marginal — it's the difference between "detected 2 animals" and "identified Frosty the tabby cat, relationship: Bestie, interaction: 45 seconds of mutual grooming."
- **Graceful degradation matters more than peak performance**: The system that *always* returns something useful beats the system that *sometimes* returns something perfect.
- **Cloud-native design pays off from day one**: Building on Cloud Run + GCS + Firestore from the start meant we could handle any video length without architectural changes.
- **The hardest AI problem isn't analysis — it's curation**: Gemini can detect everything in a video. The real challenge is deciding what matters most and presenting it as a coherent story.

## What's next for PetDay — AI Pet POV Video Insights

- **Real-Time Streaming Analysis**: Process live pet camera feeds for instant alerts (safety hazards, friend arrivals) instead of post-recording analysis
- **Longitudinal Pet Diary**: Track a pet's social relationships and mood patterns over weeks and months — see how friendships evolve and seasonal behavior changes
- **Multi-Pet Household Support**: Cross-reference footage from multiple pets in the same household to build a complete family social graph
- **Veterinary Integration**: Export behavioral and dietary reports in formats useful for veterinary checkups
- **Community Features**: Expand the Discovery feed into a full social platform where pet owners can follow each other's pets and organize meetups based on friendship compatibility
- **Hardware Partnerships**: Collaborate with pet camera manufacturers to optimize video format and frame rate for AI analysis