# PetDay Hackathon Video Demo Guide (English + Chinese)

## 🎯 Goal
Create a compelling **2-minute video demo** (standard hackathon format) that showcases the problem, the solution, and the key features of PetDay.

**Style**: Fast-paced, humorous, heartwarming, and tech-forward.

**Tools Suggested**:
-   **Audio**: ElevenLabs (for AI Voiceover)
-   **Recording**: OBS Studio or Screen Studio (for smooth cursor movement)
-   **Editing**: CapCut or DaVinci Resolve

---

## 🛠️ AI Video Production Toolkit (Recommended)

Since this is a Hackathon demo, speed and "wow factor" are key. Here are the best AI tools for each step:

### 1. Video Generation (B-Roll Only)
*Use these ONLY for the "Happy Dog" intro or generic scenes. Do NOT use them for the app demo (that must be real).*

*   **Luma Dream Machine**: Excellent for generating realistic, consistent video of pets (e.g., "A golden retriever smiling at the camera, cinematic lighting"). Free tier available.
*   **Runway Gen-3 Alpha**: High quality, good control. Great for "cinematic" B-roll.
*   **Kling AI**: Currently producing very high-quality, long-duration clips (5s+).
*   **Sora** (If you have access, otherwise stick to Luma/Kling).

### 2. Screen Recording (The App Demo)
*   **Screen Studio (Mac)**: Automatically zooms in on your mouse clicks and smooths out cursor movement. It makes a boring screen recording look like a professional promo. **Highly Recommended.**
*   **OBS Studio**: Free, powerful, but requires manual configuration.

### 3. AI Video Editing
*   **CapCut (Desktop/Mobile)**: The best all-in-one tool for hackathons.
    *   **Auto-Captions**: One-click subtitle generation (supports English & Chinese).
    *   **AI Stickers/Effects**: Great for adding emphasis without manual animation.
    *   **Text-to-Speech**: Built-in AI voices if you don't use ElevenLabs.
*   **Descript**: Edit video by editing the text transcript. Great if you record a voiceover and want to cut out "ums" and "ahs" automatically.

### 4. AI Voiceover (TTS)
*   **ElevenLabs**: Distinguishable from human speech. Use a "Narrator" voice (like "Adam" or "Rachel") for a polished look.
*   **OpenAI TTS (API)**: If you want to script it in code.

### 5. Subtitles
*   **CapCut**: Best built-in option.
*   **Veed.io**: Great for "Alex Hormozi style" dynamic captions (colorful, popping words) if you want a social media vibe.

---

## 🎬 Script (2 Minutes)

| Time | Visual Scene (Generic Description) | Audio / Voiceover (Script) |
| :--- | :--- | :--- |
| **0:00-0:15** | **The Problem**<br>Split screen: On the left, a cute dog looking happy. On the right, shaky, dizzying raw POV footage playing at 4x speed. Text overlay: "Expectation vs. Reality". | "We all wonder what our pets do all day. We strapped a camera on them, expecting *The Secret Life of Pets*... but instead, we got 3 hours of finding the perfect blade of grass. It's unwatchable." |
| **0:15-0:30** | **The Solution (PetDay)**<br>Logo animation: **PetDay**. Transition to the Dashboard UI showing a clean summary. | "That's why we built **PetDay**. An AI-powered analyst that watches the boring parts so you don't have to." |
| **0:30-0:50** | **Feature 1: The Diary & Highlights**<br>Screen recording: Scrolling through the "AI Diary" text. Then, playing the 60s "Highlight Reel" in the player. Show the smooth cuts. | "PetDay transforms raw chaos into a structured Daily Diary, written *by* your pet. And it automatically curates a 60-second highlight reel of the best action, filtering out the shake." |
| **0:50-1:10** | **Feature 2: Friends & Social**<br>Screen recording: "Friends" section. Hover over "Snowball" (Cat) and "Mochi" (Dog). Show the relationship status ("Bestie"). | "Using Gemini 3 Flash, we detect every friend your pet meets. We identify them, log the interaction, and even determine if they are a 'Bestie' or a 'Rival'." |
| **1:10-1:30** | **Feature 3: Safety & Health**<br>Screen recording: "Safety Alerts" tab. Show a warning for "Eating unknown object" or "High Jump". | "It's not just fun and games. PetDay acts as a guardian, flagging safety hazards like eating unknown objects or dangerous jumps, without you needing to scrub through hours of footage." |
| **1:30-1:50** | **The Tech (Under the Hood)**<br>Diagram animation: Raw Video -> FFmpeg -> Gemini 3 Flash (Multimodal) -> JSON -> React UI. Show code snippet of the `videoAnalyzer.ts`. | "Under the hood, we use a serverless pipeline on Google Cloud Run. We feed raw video chunks directly into Gemini's multimodal window to understand context, mood, and intent." |
| **1:50-2:00** | **Conclusion**<br>Montage of happy pet faces + PetDay Logo + URL. | "PetDay: See the world through their eyes. Try it today." |

---

## 📸 Production Checkpoints (拍摄检查点)

1.  **Preparation**:
    *   Find your best "fail" footage (shaky ground shots) for the intro.
    *   Ensure you have a processed video in the dashboard with **Friends (Snowball/Ginger)** and **Scenery** detected.
    *   Clear your browser cache to ensure the demo runs smoothly.

2.  **Screen Recording**:
    *   Record at **1080p or 4k**.
    *   Zoom in (125-150%) on the dashboard text so it's readable on mobile.
    *   Move mouse slowly and deliberately.

---

# 中文翻译 (Chinese Translation)

## 🛠️ AI 视频制作工具箱 (推荐)

既然是黑客松 Demo，速度和“惊艳感”是关键。以下是各个环节的最佳工具推荐：

### 1. 视频生成 (仅用于B-Roll空镜头)
*注意：仅用于开场的“快乐狗狗”或过场画面。**不要**用于 App 演示部分（那必须是真实的录屏）。*

*   **Luma Dream Machine**: 擅长生成逼真、连贯的宠物视频（例如：“一只金毛对着镜头微笑，电影级光效”）。有免费额度。
*   **Runway Gen-3 Alpha**: 质量极高，可控性好。适合生成“电影感”的空镜头。
*   **Kling AI (可灵)**: 目前生成长时间高质量视频（5秒+）的最佳选择之一。

### 2. 屏幕录制 (App 演示)
*   **Screen Studio (Mac)**: **强烈推荐**。它能自动放大你的鼠标点击，平滑光标移动。能把枯燥的录屏瞬间变成专业的宣传片。
*   **OBS Studio**: 免费，强大，但需要手动配置场景。

### 3. AI 视频剪辑
*   **CapCut (剪映/CapCut 桌面版)**: 黑客松的最佳“全能”工具。
    *   **自动字幕**: 一键生成字幕（支持中英）。
    *   **AI 贴纸/特效**: 无需手动做动画，快速增加重点。
    *   **文本转语音 (TTS)**: 内置 AI 语音，如果不想用 ElevenLabs 的话。
*   **Descript**: 像编辑文档一样编辑视频。如果你录了人声解说，想自动剪掉“呃”、“啊”等语气词，这个是神器。

### 4. AI 配音 (TTS)
*   **ElevenLabs**: 目前音质最自然、最接近真人的 AI 语音。推荐使用 "Narrator" 风格的声音（如 Adam 或 Rachel）来增加专业感。

### 5. 字幕 (AI Subtitles)
*   **CapCut (剪映)**: 内置功能最方便。
*   **Veed.io**: 适合制作那种单词逐个跳出、带颜色高亮的“社交媒体风格”字幕（Alex Hormozi style）。

---

## 🎬 剧本 (2 分钟)

| 时间 | 画面场景 (描述) | 音频 / 配音 (台词) |
| :--- | :--- | :--- |
| **0:00-0:15** | **痛点 (The Problem)**<br>分屏：左边是可爱的狗狗照片。右边是让人眼晕的 4 倍速原始 POV 抖动视频。字幕：“想象 vs 现实”。 | “我们都好奇宠物整天在干嘛。我们给它戴上相机，期待拍出《爱宠大机密》……结果却是 3 小时对着草地的发呆。这根本没法看。” |
| **0:15-0:30** | **解决方案 (PetDay)**<br>Logo 动画：**PetDay**。转场到仪表盘 UI，展示整洁的摘要页。 | “这就是我们构建 **PetDay** 的原因。一个 AI 分析师，替你看完那些无聊的片段。” |
| **0:30-0:50** | **功能 1: 日记与高光 (Diary & Highlights)**<br>录屏：滚动浏览“AI 日记”文本。然后播放播放器里的 60 秒“高光集锦”。展示流畅的剪辑。 | “PetDay 把原始的混乱画面转化为结构化的‘每日日记’，而且是以宠物的口吻写的。它还能自动剪辑出 60 秒的高光时刻，过滤掉抖动画面。” |
| **0:50-1:10** | **功能 2: 朋友与社交 (Friends & Social)**<br>录屏：“朋友”板块。鼠标悬停在“Snowball”（猫）和“Mochi”（狗）上。展示关系状态（“死党/Bestie”）。 | “利用 Gemini 3 Flash，我们能检测到宠物遇到的每一个朋友。我们识别它们，记录互动，甚至判断它是‘死党’还是‘死对头’。” |
| **1:10-1:30** | **功能 3: 安全与健康 (Safety & Health)**<br>录屏：“安全警报”标签页。展示“误食异物”或“高处跳跃”的警报。 | “不仅仅是好玩。PetDay 还是一个守护者，无需你手动翻看数小时视频，就能标记出误食异物或危险跳跃等安全隐患。” |
| **1:30-1:50** | **技术实现 (The Tech)**<br>架构图动画：原始视频 -> FFmpeg -> Gemini 3 Flash (多模态) -> JSON -> React UI。展示 `videoAnalyzer.ts` 的代码片段。 | “在底层，我们使用 Google Cloud Run 上的无服务器管道。我们将原始视频块直接输入 Gemini 的多模态窗口，以理解上下文、情绪和意图。” |
| **1:50-2:00** | **结尾 (Conclusion)**<br>快乐宠物的蒙太奇剪辑 + PetDay Logo + 网址。 | “PetDay：通过它们的眼睛看世界。今天就来试试吧。” |

---

## 📸 拍摄建议

1.  **准备工作**:
    *   找一段最“失败”的原始素材（对着地面的抖动镜头）作为开场。
    *   确保仪表盘里有一个处理完美的视频，包含 **朋友 (Snowball/Ginger)** 和 **风景 (Scenery)**。
    *   清理浏览器缓存，确保演示流畅。

2.  **录屏技巧**:
    *   使用 **1080p 或 4k** 录制。
    *   浏览器缩放调至 **125-150%**，保证文字在手机上也能看清。
    *   鼠标移动要慢、要稳。
