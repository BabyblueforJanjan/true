const keyInput = document.getElementById("key");
const msg = document.getElementById("msg");

chrome.storage.sync.get("apiKey").then(({ apiKey }) => {
  if (apiKey) keyInput.value = apiKey;
});

document.getElementById("save").onclick = async () => {
  await chrome.storage.sync.set({ apiKey: keyInput.value.trim() });
  msg.textContent = "✅ บันทึกแล้ว";
};
