// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const OpenAI = require("openai"); // ✅ الكلاس نفسه، مو { OpenAI }

dotenv.config();

const app = express();

// --- إعداد OpenAI ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

// --- إعدادات عامة ---
const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, "chat.log");

// --- دالة بسيطة لتسجيل اللوقز في ملف + الكونسول ---
function logEvent(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message} ${
    Object.keys(meta).length ? JSON.stringify(meta) : ""
  }\n`;

  // إلى الكونسول
  if (level === "ERROR") {
    console.error(line.trim());
  } else {
    console.log(line.trim());
  }

  // إلى ملف chat.log (best effort)
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    console.error("Failed to write log file:", err.message);
  }
}

// --- ميدل وير ---
app.use(express.json());

// نخلي إكسبريس يقدّم الملفات الثابتة من نفس المجلد
// مثل chat.html و logo-ncir.png
app.use(express.static(__dirname));

// ✅ صفحة الصحة (ممكن تستخدمها للمراقبة)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    assistantConfigured: Boolean(ASSISTANT_ID),
    time: new Date().toISOString(),
  });
});

// ✅ الصفحة الرئيسية ترجع صفحة الشات مباشرة
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "chat.html"));
});

// ✅ خلي /chat تفتح نفس صفحة الشات (عشان لو أحد استخدمها)
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "chat.html"));
});

// ✅ API لاستقبال رسالة المستخدم والرد من الـ Assistant
// الفرونت يستخدم /api/chat
app.post("/api/chat", async (req, res) => {
  const requestStart = Date.now();
  const { message: userMessage, threadId: incomingThreadId } = req.body || {};

  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const userAgent = req.headers["user-agent"] || "unknown";

  logEvent("INFO", "Incoming /api/chat request", {
    ip: clientIp,
    userAgent,
    body: { message: userMessage, threadId: incomingThreadId || null },
  });

  try {
    if (!userMessage) {
      logEvent("WARN", "Missing 'message' in /api/chat request");
      return res.status(400).json({ error: "message is required" });
    }

    if (!ASSISTANT_ID) {
      logEvent("ERROR", "ASSISTANT_ID is not set in environment");
      return res.status(500).json({ error: "ASSISTANT_ID is not set" });
    }

    let threadId = incomingThreadId || null;

    // 🔹 لو ما فيه threadId نبدأ ثريد جديد
    if (!threadId) {
      const t0 = Date.now();
      const thread = await client.beta.threads.create();
      threadId = thread.id;
      logEvent("INFO", "Created new thread", {
        threadId,
        durationMs: Date.now() - t0,
      });
    }

    // 1) إضافة رسالة المستخدم للثريد
    const tMessageStart = Date.now();
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });
    logEvent("INFO", "Added user message to thread", {
      threadId,
      durationMs: Date.now() - tMessageStart,
    });

    // 2) تشغيل الـ Assistant والانتظار
    const tRunStart = Date.now();
    const run = await client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASSISTANT_ID,
    });
    const runDuration = Date.now() - tRunStart;

    logEvent("INFO", "Assistant run completed", {
      threadId,
      runId: run.id,
      status: run.status,
      durationMs: runDuration,
    });

    if (run.status !== "completed") {
      logEvent("ERROR", "Run did not complete successfully", {
        threadId,
        runId: run.id,
        status: run.status,
      });

      return res.status(500).json({
        answer: `تعذر إكمال تشغيل المساعد. الحالة الحالية: ${run.status}`,
        threadId,
      });
    }

    // 3) جلب آخر رسالة (رد المساعد)
    const tMessagesStart = Date.now();
    const messages = await client.beta.threads.messages.list(threadId, {
      limit: 1,
    });

    const assistantMessage = messages.data[0];
    const textPart = assistantMessage?.content?.find(
      (p) => p.type === "text"
    );
    const replyText =
      textPart?.text?.value || "لم أستطع قراءة رد المساعد.";

    logEvent("INFO", "Fetched assistant reply", {
      threadId,
      durationMs: Date.now() - tMessagesStart,
      preview: replyText.slice(0, 120),
    });

    // 4) إرسال الرد للفرونت بالشكل اللي يتوقعه chat.html
    const totalDuration = Date.now() - requestStart;
    logEvent("INFO", "Completed /api/chat request", {
      threadId,
      totalDurationMs: totalDuration,
    });

    return res.json({
      answer: replyText,
      threadId,
    });
  } catch (err) {
    const totalDuration = Date.now() - requestStart;
    logEvent("ERROR", "Unhandled error in /api/chat", {
      durationMs: totalDuration,
      message: err.message,
      stack: err.stack?.split("\n")[0],
    });

    return res.status(500).json({
      answer:
        "حدث خطأ أثناء الاتصال بالمساعد. تأكد من إعدادات OPENAI_API_KEY و ASSISTANT_ID أو حاول مرة أخرى لاحقاً.",
      threadId: incomingThreadId || null,
    });
  }
});

// --- تشغيل السيرفر ---
app.listen(PORT, "0.0.0.0", () => {
  logEvent("INFO", "Server started", { port: PORT });
  console.log(`Server running on port ${PORT}`);
});
