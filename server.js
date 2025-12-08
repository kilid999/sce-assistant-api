const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const { OpenAI } = require("openai");

dotenv.config();

const app = express();

// --- إعداد OpenAI ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// --- ميدل وير ---
app.use(express.json());

// نخلي إكسبريس يقدّم أي ملف موجود في نفس المجلد
// مثل chat.html و sce-logo.png
app.use(express.static(__dirname));

// صفحة الصحة / الرئيسية
app.get("/", (req, res) => {
  res.send('SCE Assistant API is running. Go to <a href="/chat">/chat</a>');
});

// نخلي /chat ترجع ملف chat.html
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "chat.html"));
});

// API لاستقبال رسالة المستخدم والرد من الـ Assistant
app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body?.message;

    if (!userMessage) {
      return res.status(400).json({ error: "message is required" });
    }

    if (!ASSISTANT_ID) {
      return res.status(500).json({ error: "ASSISTANT_ID is not set" });
    }

    // 1) إنشاء ثريد جديد لكل محادثة بسيطة (مناسب للـ PoC)
    const thread = await client.beta.threads.create();

    // 2) إضافة رسالة المستخدم
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // 3) تشغيل الـ Assistant وانتظار النتيجة
    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    if (run.status !== "completed") {
      return res.status(500).json({
        error: `Run did not complete. Status: ${run.status}`,
      });
    }

    // 4) جلب آخر رسالة من الثريد (رد الـ Assistant)
    const messages = await client.beta.threads.messages.list(thread.id, {
      limit: 1,
    });

    const assistantMessage = messages.data[0];
    const textPart = assistantMessage.content.find((p) => p.type === "text");
    const replyText = textPart?.text?.value || "";

    return res.json({ reply: replyText });
  } catch (err) {
    console.error("Error in /chat:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// --- تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
