const runBtn = document.getElementById("run");
const status = document.getElementById("status");

const keyInput = document.getElementById("key");

chrome.storage.sync.get("apiKey").then(({ apiKey }) => {
  if (apiKey) keyInput.value = apiKey;
});

document.getElementById("save").onclick = async () => {
  await chrome.storage.sync.set({ apiKey: keyInput.value.trim() });
  status.textContent = "✅ บันทึก API key แล้ว";
};

runBtn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://docs.google.com/forms/")) {
    status.textContent = "เปิดหน้า Google Form ก่อนนะ";
    return;
  }
  runBtn.disabled = true;
  status.textContent = "⏳ Claude กำลังคิด... (ดูผลที่มุมขวาของหน้า)";
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "RUN_HELPER" });
    status.textContent = res?.ok ? `✅ เสร็จแล้ว ${res.count} ข้อ` : `❌ ${res?.error || "เกิดข้อผิดพลาด"}`;
  } catch {
    status.textContent = "❌ รีเฟรชหน้า Google Form แล้วลองใหม่";
  } finally {
    runBtn.disabled = false;
  }
};
