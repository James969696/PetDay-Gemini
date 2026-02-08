# **Technical Roadmap for PetDay AI Video Analysis**

## **System Architecture Overview**

Design the system as a cloud-based pipeline that takes an uploaded pet-camera video, processes it through AI services, and returns a highlight reel video plus a text narrative. The **frontend (UI/UX)** is already completed, so focus on building a **Google Cloud-based backend** for analysis and content generation. A typical flow might be:

1. **Video Upload:** User uploads the pet’s POV video (minutes to hours) to cloud storage (e.g. Google Cloud Storage). This triggers backend processing (via Cloud Functions or Cloud Run).

2. **Video Analysis Pipeline:** The backend analyzes the video and audio to extract insights – using Google’s AI services (Gemini API and others).

3. **Highlight Generation:** Identify the most interesting or important segments of the video and automatically **edit/compile a 1-minute highlight reel**.

4. **Narrative Generation:** Use an AI model to create a narrative from the pet’s perspective, incorporating key findings (friends met, favorite spots, activities, etc.).

5. **Result Delivery:** Store the output video and narrative (possibly in a database or storage) and return them to the frontend for the user to view or download.

This architecture separates concerns: storage, processing (analysis & editing), and content generation. By leveraging managed Google services, we can keep the infrastructure minimal (no servers to manage) and scale on-demand.

## **Video Analysis Pipeline**

### **Video Content Understanding**

Leverage **Google Cloud Video Intelligence API** for initial video understanding and metadata extraction. This API can recognize **over 20,000 objects, places, and actions** in videos, providing rich labels at the video, shot, and frame level. For example, it can label when other **animals or people** appear (potential “friends”), identify environments (park, home, etc.), and detect significant actions (running, eating, etc.). The Video Intelligence API can analyze the video for:

* **Label Detection:** Tag objects and scenes throughout the video (e.g. “dog,” “cat,” “car,” “indoors,” “grassland”). This helps find when the pet encounters friends (other pets or humans) or notable scenery. The API’s pre-trained models are highly comprehensive and improve over time.

* **Shot/Scene Detection:** Identify scene changes or distinct segments. This helps break the video into logical parts and find transitions (useful for summary).

* **Object Tracking:** Track moving objects (e.g. the pet’s owner or a specific dog) through frames. If the pet has known playmates or regular human friends, object tracking could follow them in the video.

* **People Detection:** Recognize human figures in the video. Although it won’t identify individuals by name without training, it flags where a person appears (the pet’s owner could be inferred as a frequent person in view).

* **Audio Transcription:** Use Cloud Video API’s speech transcription or **Cloud Speech-to-Text** to transcribe any audible speech in the video. For example, if the owner talks or there are barks/meows, capturing that can add context (e.g. a bark sequence might indicate excitement).

The output of these analyses is **structured metadata**: a timeline of labels and events (e.g. “00:10 – dog encounters a cat”, “00:45 – dog is running in a park with children around”). This data is crucial for pinpointing **highlights** and feeding into the narrative. By doing this pre-processing, we reduce the burden on the more expensive general AI model and **minimize token usage** – we only pass salient information forward.

### **Using Google Gemini Multimodal API**

For deeper understanding and narrative-level analysis, integrate **Google’s Gemini API**, which is a multimodal AI model capable of processing video+audio content. Gemini can ingest the video (via a Cloud Storage URI or YouTube link) along with a text prompt, and generate detailed responses. Key capabilities of Gemini that we can leverage include:

* **Summarization of Long Videos:** Gemini can analyze videos up to \~90 minutes in one request (longer videos can be split into chunks). It processes visual frames (at about 1 frame/sec by default) and audio together to understand context. We can prompt it to *“summarize the pet’s day from this video”* or ask for *“key events with timestamps.”* In fact, Gemini can not only summarize but also extract structured details or answer specific questions about the video. This is useful to identify moments like “when did the pet meet someone?” or “what made the pet excited?”

* **Key Moment Identification:** We can instruct Gemini to list the **most salient moments** in the video, and it can provide timestamps for those events. For example, prompt: *“Describe the key events in this video, with timestamps for important or exciting moments”*. The model might output something like: *“00:05 – Pet greets a neighbor’s dog happily. 00:47 – Pet chases a squirrel. 01:30 – Pet takes a nap under the couch….”* Gemini’s ability to **reference timestamps** in its response is crucial for building the highlight reel.

* **Multimodal Insight:** Because Gemini analyzes both audio and visual streams together, it can infer things like the pet’s **emotional state or reactions** from cues (e.g. excited barking in audio plus energetic movement in video might be interpreted as joy). It can also catch auditory events (a doorbell ringing, etc.) that Video Intelligence alone might miss. This supports building the *“emotional chart”* or detecting potential **risks** (e.g. the sound of traffic or the pet growling).

* **Structured Data Extraction:** We can ask Gemini to output certain findings in JSON or a structured format. For example, we might prompt it: *“List all other animals or people the pet interacted with, and describe each interaction with a timestamp.”* This yields data specifically for *“pet’s friends”* and interactions. Similarly, *“Identify any potential dangers the pet encountered”* could yield a list of warnings (e.g. *“pet crossed a road at 00:10”* or *“pet chewed unknown object at 00:55”* if evident).

**Integration Approach:** Use the Gemini API via Vertex AI or Firebase AI SDK. The video (from Cloud Storage) can be passed by URI to the model, avoiding sending large data inline (since there’s a 20MB inline limit). The backend might orchestrate multiple Gemini requests for long videos or different queries. For example, one request could get a high-level summary, another could query specific details (friends, activities, etc.) to ensure nothing is missed. Because **cost and token usage** are considerations, we might do an initial run with Video Intelligence and then feed its findings as context into a Gemini prompt rather than letting Gemini process every raw frame. This *hybrid approach* (pre-process with cheaper specialized API, then use Gemini for reasoning) can **increase accuracy and reduce token consumption** by focusing the AI on key data.

## **Automated Highlight Reel Generation**

Generating the one-minute highlight reel involves selecting the best clips from the full video and stitching them together. This requires both identifying highlights and performing video editing:

* **Highlight Selection:** Using insights from the analysis pipeline, determine which segments of the video are “highlights”. Some criteria:

  1. **High “Highlight Score” Segments:** From research on first-person video summarization, segments with a lot of activity or importance (e.g. interactions, new locations) are considered highlights. Our pipeline’s outputs (Gemini’s key moments, or high-motion intervals) give these scores. For example, if the pet suddenly runs or plays actively at certain times, those segments score high as highlights.

  2. **Unique Events:** Ensure the highlights cover diverse events (meeting a friend, exploring a hideout, playing, etc.) rather than repetitive scenes. The Video Intelligence labels can help avoid redundancy – e.g. if the pet spends 2 hours sleeping, we might include only a very brief snippet to represent “napping” and focus more on unique actions.

  3. **Emotional or Interesting Moments:** If the pet exhibits noticeable emotion or something funny/unusual happens (e.g. pet’s excited reaction to seeing its owner, or a mischievous act like stealing food), those are prime highlight candidates. The narrative analysis might flag these (e.g. Gemini might describe a “happy reunion at 00:30” – that suggests a highlight moment).

  4. **Duration and Transitions:** Once candidate segments are chosen, pick snippets that can total \~60 seconds. For instance, maybe 6–10 clips of 5-10 seconds each that together tell the story of the day. Each clip should be long enough to be understandable but short enough to keep the pace. Smoothly transition between clips by time order or thematic grouping (morning, noon, evening of pet’s day).

* **Video Editing Automation:** Use a programmatic video editing approach. Since we are using Google products, one option is employing **Google Cloud Transcoder API** or simply running a video editing library on Cloud infrastructure. The Transcoder API can convert and trim videos, but a simpler path is to use a tool like **FFmpeg** in a Cloud Run service:

  1. Load the original video from Cloud Storage.

  2. For each highlight segment (with start/end timestamps determined), use FFmpeg to **trim** that segment.

  3. Concatenate the trimmed segments in chronological order.

  4. Possibly add simple transitions or title cards (e.g. “Buddy meets a friend at the park”) if desired for UX – though initially straightforward cuts are fine.

* This process can be encapsulated in a Cloud Run job that runs when analysis is done. It yields a **final MP4 video** \~1 minute long, which is then saved back to Cloud Storage (and a URL returned to the frontend). All of this is automatic – no manual editing – fulfilling the *“自动剪辑”* (automatic editing) requirement.

* **Quality Considerations:** Ensure the clips chosen make sense without too much context. If needed, overlay captions or the pet’s narrative subtitles on the video to enhance storytelling. However, this could be a later enhancement. Initially, focus on clear video segments (with maybe the original audio for atmosphere, unless there’s a lot of noise – then perhaps background music could be considered later for a polished feel).

By using the analytic data to drive clip selection, we ensure the highlight reel isn’t random but truly reflective of the pet’s favorite moments and important events.

## **Narrative Generation (Pet’s Perspective)**

Creating the narrative “diary entry” from the pet’s point of view is a creative application of the AI. This will utilize a large language model (LLM) – in this case, likely Gemini (or a PaLM model) – to generate text based on the structured understanding of the video. Steps and suggestions for this component:

* **Persona and Tone:** We want the output in the pet’s voice (first person as the pet). This can be achieved by crafting the prompt with appropriate instructions. For example: *“You are a \[happy dog / curious cat\] describing your day to your owner. Use a friendly, **pet-like tone** and mention events as if you experienced them.”* We might set this as a **system message** or preface in the prompt for the LLM. The tone should be warm and playful (since it’s from a pet’s POV), making assumptions like “my human” for the owner, etc., for a charming effect.

* **Content to Include:** Provide the model with bullet points or data that it must cover, gathered from earlier analysis. For instance:

  * *Friends:* List of animals/people encountered (e.g. “Neighbor dog (Buddy) at 2:30pm in the park”). The narrative can then say “I met **Buddy** at the park – we sniffed and played together, it was the best part of my day\!”.

  * *Favorite Scenery:* Notable places the pet seemed to enjoy (e.g. “sunny spot by the window” or “under the old oak tree”). The narrative might say “I found a **secret sunny spot** by the window where I took a nap. It’s my secret hideout\!”.

  * *Secret Hideouts:* If the pet returned to a particular hidden corner or spot frequently (as seen in video), mention it as a treasured hideout (the system might not *truly* know it’s secret, but if it’s an isolated place the pet goes, we infer it).

  * *Emotional Chart:* Summarize the pet’s mood over the day (e.g. energetic morning, calm afternoon, anxious moment at the vet, etc.). We can supply an approximate timeline of emotions (from our analysis of activity and audio cues) and ask the model to express it, perhaps even in a fun way (like “My mood today: 🥳 morning excitement, 😴 midday lazy nap, 😁 evening happiness when I saw my owner”).

  * *Activity Summary:* Ensure the narrative covers main activities (running, playing, eating, sleeping). We already identify these via labels (Video AI can label actions like running or eating, and we can detect “long periods with little movement \= sleeping”). Feed these to the LLM so it mentions them: “I ran around the yard, dug a hole, and later I enjoyed my dinner kibble before snoozing.”

  * *Warnings (Risks):* If any potential danger or anomaly was noted (e.g. pet went outside bounds, encountered a hostile animal, ate something off the ground), include a line from the pet or an addendum for the owner. Possibly, the pet’s perspective might say “I chased a car on the road – it was exciting, but maybe I shouldn’t do that\!” or a more straightforward separate section for the human: “**Warning:** Bella went near a busy street today around 3:00pm, please be careful.” The format could be decided based on what’s clearer – either in-character or a clearly marked alert aside from the pet’s voice.

* **LLM Prompting Strategy:** One approach is to **give the LLM a structured template** or outline for the report and let it fill it in. For example, prompt:  
   *“Using the information provided, write a report from the dog’s perspective about its day. The report should include: 1\) Introduction (overall day sentiment), 2\) Friends the pet met, 3\) Favorite places or scenery, 4\) Secret hideouts it visited, 5\) How it felt (emotional chart), 6\) Activity summary of the day, and 7\) Warnings or things that scared it. Keep it in a friendly first-person tone as if written by the pet.”*  
   Then provide the bullet points of events/emotions extracted. The LLM (Gemini or PaLM) will then turn that into a coherent narrative story, touching all the points.

* **Ensuring Accuracy:** Because the narrative is user-facing and could be taken as “what really happened,” we want it to be grounded in the video data. Supplying the actual extracted facts (rather than just letting the model imagine freely) is important to avoid hallucination. For example, if the video shows no other animals, the model shouldn’t fabricate a “friend” – our input data would simply have none in that category, so that section might be omitted or say “I didn’t see any of my friends today.” By structuring the input, we control this.

* **Multilingual/Localization (Future):** Since part of the query was in Chinese, note that Google’s models support multiple languages. The narrative could be generated in the user’s preferred language. For now, focus on one language output and ensure the content is translatable if needed.

The narrative combined with the highlight reel creates a rich, story-like summary of the pet’s day. This can be presented in the app as text alongside the video. It adds a personal touch that engages the user emotionally.

## **Backend Implementation with Google Cloud Services**

To meet the requirements of **all-Google technology stack, minimal user effort, and low cost**, design the backend with serverless and fully-managed Google Cloud components:

* **Cloud Storage:** Central for storing user videos and the output highlight reels. When a user uploads a video via the front-end, it gets stored in a **Storage bucket**. Use a structured naming (e.g. `videos/{userId}/{uploadDate}.mp4` and later `highlights/{userId}/{videoId}_highlight.mp4`). The bucket can trigger events. For instance, a **Cloud Storage trigger** can invoke a **Cloud Function** when a new video is uploaded. This kickstarts the analysis pipeline without the user needing to click anything extra.

* **Cloud Functions / Cloud Run:** Use Cloud Functions for lightweight orchestration – e.g. a function triggers on upload, writes a task to process the video. If the analysis is heavy or long-running (processing hours of video can take time), you might use Cloud Run (which can run longer and with more resources). For example:

  * A Cloud Function (short-lived) picks up the event and enqueues a job (perhaps writing a message to **Cloud Pub/Sub** or a **Cloud Tasks** queue) for processing the video.

  * A Cloud Run service (or a Workflows pipeline) then performs the analysis steps: calls Video Intelligence API, calls Gemini API, and waits for results. Cloud Run is good because it can run up to 60 minutes if needed, handle dependencies like FFmpeg, and scale as needed.

  * After analysis, the Cloud Run service can invoke the video editing routine (which could be within the same service if FFmpeg is installed, or another function). The highlight video is generated and saved.

  * Finally, store the narrative text (maybe in **Firestore** or simply in Cloud Storage as a .txt/.json) along with metadata like the emotional chart data if needed.

* **Vertex AI / AI Platform:** Since we plan to use Gemini via API, we must set up Google’s GenAI services. Using **Vertex AI’s Generative AI support** is recommended for production (it provides enterprise management, monitoring, and you can use the **Gemini models** there). The code can call Vertex AI’s `generateContent` with the video and prompt. Alternatively, Firebase AI Extensions provides a convenient SDK (as per Firebase AI Logic docs) to call Gemini from web/mobile, but since we need backend orchestration and possibly combining multiple ML results, Vertex AI SDK on the backend is suitable.

* **Data Management:** Keep a record of each processed video and results. For instance, a **Firestore** document per upload could store: user ID, status (processing/done), narrative text, link to highlight video, timestamp, etc. This can help the front-end query the status and display results when ready. It also allows future analytics (like average pet activity times, etc.). Firestore is serverless and will keep costs low at our expected scale.

* **Notification & UX:** To maximize user convenience, the user shouldn’t have to wait watching a loading bar for potentially a long time. Instead, implement a notification or async update: when processing finishes, you could send a push notification or in-app notification (if the app supports it), or simply update the UI to show “Your pet’s Day is ready\!” The exact mechanism can be via Firebase Cloud Messaging or a simple polling from the front-end to check if processing is done.

* **Scaling and Cost Control:** All chosen components (Cloud Functions, Run, Vertex AI calls) scale automatically per use. We should set appropriate **quotas and budget alerts**. For example, limit how many videos can be processed concurrently if needed to avoid runaway cost. Use the 1000 free minutes/month of Video Intelligence API and the free tier of Vertex AI if possible during development. Also, choose the right **Gemini model size**: perhaps use *Gemini Flash or Flash-Lite* for quicker, cheaper analysis in early tests, and only use *Gemini Pro* if needed for better accuracy on complex tasks. Google’s pricing shows Flash models are much cheaper per token than Pro. A combination of smaller models \+ our own pre-analysis can significantly reduce cost while maintaining good accuracy.

## **Cost Optimization Strategies**

Building a cost-effective solution is crucial, especially given the potentially long videos. Here are specific tactics to keep costs low and the system efficient:

* **Pre-Filtering and Sampling:** Not all video frames are equally important. We can implement a pre-filter (even before Video Intelligence API) to skip analysis during “boring” parts. For instance, use a simple motion detector or the video’s metadata: if the pet is asleep (little movement, no audio spikes) for 30 minutes, we don’t need to feed all those frames to Gemini in detail. Instead, note it as “sleeping from X to Y” and maybe sample one frame or two. Gemini’s API allows setting a custom frame sampling rate or clipping intervals. We can split the video such that we only fully analyze segments where something happens, and summarize the long idle segments with a brief note. This reduces the data volume sent to AI.

* **Use Specialized APIs for Specific Data:** As mentioned, rely on cheaper specialized services for raw data extraction (object labels, transcriptions) and reserve the expensive LLM for higher-level reasoning. The Video Intelligence API has a generous free tier and low cost per minute; using it to label a 2-hour video will cost far less than sending a 2-hour video’s worth of frames to an LLM. We then send **only the labels/events** (which are text, very light on tokens) into Gemini to contextualize the summary. This **reduces token consumption drastically** because the LLM doesn’t need to describe every frame – it works off the distilled info.

* **Token Management and Chunking:** When we do have to send video to Gemini, if the video is extremely long (say 3-4 hours, beyond the \~90 min comfortable limit), break it into parts. Summarize each part separately (e.g. morning, afternoon segments), then perhaps do one more LLM call to combine summaries into one coherent story. This chunking ensures we don’t hit context length limits and also that each call stays within reasonable token counts. Google’s documentation suggests models like Gemini can handle very large context, but it may be billed more for very long prompts. Better to chunk and summarize iteratively (hierarchical summarization).

* **Choose the Right Model Version:** Google offers multiple Gemini model variants (Flash, Flash-Lite, Pro, etc.) with different pricing. For development or less critical analysis, using **Gemini Flash or Flash-Lite** might be 10x+ cheaper per token than Pro, at the cost of some accuracy. We could adopt a strategy to use a cheaper model for initial analysis, then if something is ambiguous or needs better reasoning, selectively call the more advanced model on that part. Also, if we mainly need text summary (not code or very complex reasoning), the Flash models might suffice. This hybrid model usage can cut costs.

* **Leverage Free Tiers and Optimized Compute:** As noted, use the free tier quotas for Video Intelligence (1,000 minutes/month). For compute, Cloud Functions and Run have free tiers too. We should process videos sequentially per user (unless real-time speed is needed) to possibly reuse one allocated instance for multiple tasks (Cloud Run can reuse container for multiple requests, reducing start-up overhead). If video processing doesn’t require GPU, stick to CPU to save cost – Google’s video and LLM APIs run on Google’s side (their cost is encapsulated in the API price), so our backend mainly just orchestrates and does lightweight tasks (aside from FFmpeg). The FFmpeg step for a 1-minute output is not heavy; even a 1GB video can be cut in seconds without needing large memory.

* **Monitor and Iterate:** Implement logging and perhaps a cost monitor. For example, log how many tokens each Gemini request uses (the API may return token counts). This helps identify if a certain prompt is blowing up token usage (maybe too verbose intermediate data). We can then refine prompts or data size. Also monitor how long each step takes – maybe we find Video Intelligence is fast and cheap for certain detections and we can use more of it (like person detection) instead of asking Gemini to identify people, etc.

By thoughtfully combining services and limiting what we send to the expensive components, we adhere to the **“成本最低、用户最便捷”** principle – minimizing cost while keeping it seamless for the user (they just upload and wait briefly, not having to do any manual trimming or input).

