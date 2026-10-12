// Service worker: รับคำถามจาก content script แล้วส่งไปให้ Claude
// เรียก Messages API ด้วย fetch ตรงๆ เพราะ extension นี้ไม่มีขั้นตอน build/bundle

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-5-5";

const SYSTEM_PROMPT = `คุณคือติวเตอร์ที่ช่วยนักเรียนทำแบบฝึกหัดและ quiz ฝึกซ้อม
สำหรับแต่ละข้อ ให้ตอบคำตอบที่ถูกต้องที่สุด และอธิบายเหตุผลสั้นๆ เป็นภาษาไทยให้เข้าใจแนวคิด
- ข้อเลือกตอบ (choice/checkbox/dropdown): ใส่ข้อความตัวเลือกใน "choices" ให้ตรงกับตัวเลือกที่ให้มาทุกตัวอักษร
- ข้อเขียนตอบ (text/paragraph): ใส่คำตอบใน "text" และปล่อย "choices" เป็น []
- ถ้าข้อนั้นถามข้อมูลส่วนตัว (เช่น ชื่อ เลขที่ อีเมล) หรือตอบไม่ได้ ให้ "skip": true และบอกเหตุผลใน "explanation"`;

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          choices: { type: "array", items: { type: "string" } },
          text: { type: "string" },
          explanation: { type: "string" },
          skip: { type: "boolean" }
        },
        required: ["index", "choices", "text", "explanation", "skip"],
        additionalProperties: false
      }
    }
  },
  required: ["answers"],
  additionalProperties: false
};

function formatQuestions(questions) {
  return questions
    .map((q) => {
      let s = `ข้อ ${q.index} [${q.type}]: ${q.title}`;
      if (q.description) s += `\nรายละเอียด: ${q.description}`;
      if (q.options.length) s += `\nตัวเลือก:\n${q.options.map((o) => `- ${o}`).join("\n")}`;
      return s;
    })
    .join("\n\n");
}

async function askClaude(questions, formTitle) {
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  if (!apiKey) {
    throw new Error("ยังไม่ได้ใส่ API key — คลิกขวาที่ไอคอน extension > ตัวเลือก (Options)");
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ANSWER_SCHEMA }
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `แบบฝึกหัด: ${formTitle || "(ไม่มีชื่อ)"}\n\n${formatQuestions(questions)}`
        }
      ]
    })
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error("API key ไม่ถูกต้อง");
    if (res.status === 429) throw new Error("เรียกใช้บ่อยเกินไป ลองใหม่อีกสักครู่");
    throw new Error(`Claude API ผิดพลาด (${res.status}): ${msg}`);
  }

  if (data.stop_reason === "refusal") {
    throw new Error("Claude ปฏิเสธคำขอนี้");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("คำถามเยอะเกินไป คำตอบถูกตัด ลองแบ่งทำทีละส่วน");
  }

  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("ไม่ได้รับคำตอบจาก Claude");
  return JSON.parse(textBlock.text).answers;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "ASK_CLAUDE") return;
  askClaude(msg.questions, msg.formTitle)
    .then((answers) => sendResponse({ ok: true, answers }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // ตอบกลับแบบ async
});
