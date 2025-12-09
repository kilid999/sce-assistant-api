// server.js
const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const OpenAI = require("openai");   // ✅ مو { OpenAI }، الكلاس نفسه

dotenv.config();

const app = express();

// --- إعداد OpenAI ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// --- ميدل وير ---
app.use(express.json());

// نخلي إكسبريس يقدّم الملفات الثابتة من نفس المجلد
// مثل chat.html و logo-ncir.png
app.use(express.static(__dirname));

// ✅ الصفحة الرئيسية ترجع صفحة الشات مباشرة
app.get("/", (req, res) => {
  // تأكد أن اسم الملف هو chat.html (أو غيّره هنا لو مختلف)
  res.sendFile(path.join(__dirname, "chat.html"));
});

// ✅ API لاستقبال رسالة المستخدم والرد من الـ Assistant
// حطيناها على /api/chat عشان نميّزها عن صفحة الشات
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body?.message;
    let threadId = req.body?.threadId || null;

    if (!userMessage) {
      return res.status(400).json({ error: "message is required" });
    }

    if (!ASSISTANT_ID) {
      return res.status(500).json({ error: "ASSISTANT_ID is not set" });
    }

    // 🔹 لو فيه threadId من الواجهة نعيد استخدامه، غير كذا ننشئ واحد جديد
    if (!threadId) {
      const thread = await client.beta.threads.create();
      threadId = thread.id;
    }

    // 1) إضافة رسالة المستخدم
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // 2) تشغيل الـ Assistant
    const run = await client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASSISTANT_ID,
    });

    if (run.status !== "completed") {
      return res.status(500).json({
        error: `Run did not complete. Status: ${run.status}`,
        threadId,
      });
    }

    // 3) جلب آخر رسالة من الثريد (رد الـ Assistant)
    const messages = await client.beta.threads.messages.list(threadId, {
      limit: 1,
    });

    const assistantMessage = messages.data[0];
    const textPart = assistantMessage?.content?.find((p) => p.type === "text");
    const replyText = textPart?.text?.value || "لم أستطع قراءة رد المساعد.";

    // ✅ فورمات الرد اللي تتوقعه صفحة الشات الجديدة
    return res.json({
      answer: replyText,
      threadId: threadId,
    });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    return res.status(500).json({
      answer: "حدث خطأ أثناء الاتصال بالمساعد. تأكد من إعدادات OPENAI_API_KEY و ASSISTANT_ID.",
      threadId: null,
      details: err.message,
    });
  }
});

// --- تشغيل السيرفر ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
