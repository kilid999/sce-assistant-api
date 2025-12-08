const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const OpenAI = require("openai");
const path = require("path");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// عميل OpenAI
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// نقطة نهاية الشات
app.post("/chat", async (req, res) => {
  try {
    const { message, threadId } = req.body;

    // لو فيه threadId نكمل عليه، لو لا ننشئ واحد جديد
    const thread = threadId
      ? { id: threadId }
      : await client.beta.threads.create({});

    // نضيف رسالة المستخدم
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });

    // نشغّل الـ Assistant
    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    if (run.status !== "completed") {
      return res.status(500).json({ error: "Assistant did not complete." });
    }

    // نجيب آخر رد من المساعد
    const messages = await client.beta.threads.messages.list(thread.id, {
      order: "desc",
      limit: 1,
    });

    const assistantMessage = messages.data[0];
    const answer = assistantMessage.content[0].text.value;

    res.json({ threadId: thread.id, answer });
  } catch (err) {
    console.error("❌ API Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// مسار بسيط للفحص
app.get("/", (req, res) => {
  res.send("SCE Assistant API is running");
});

// Render يمرّر PORT من الـ env
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
