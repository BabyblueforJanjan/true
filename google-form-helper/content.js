// Content script: อ่านคำถามจากหน้า Google Form, แสดงคำตอบ+คำอธิบาย, และกรอกให้เมื่อผู้ใช้กด

(() => {
  let questionEls = []; // index -> element ของคำถาม

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").replace(/\s*\*$/, "").trim();
  }

  function optionLabel(el) {
    return clean(el.getAttribute("data-value") || el.getAttribute("data-answer-value") || el.getAttribute("aria-label"));
  }

  function extractQuestions() {
    questionEls = [];
    const questions = [];
    document.querySelectorAll('div[role="listitem"]').forEach((item) => {
      const heading = item.querySelector('[role="heading"]');
      if (!heading) return;

      const radios = [...item.querySelectorAll('[role="radio"]')];
      const checks = [...item.querySelectorAll('[role="checkbox"]')];
      const listbox = item.querySelector('[role="listbox"]');
      const textInput = item.querySelector('input[type="text"], input:not([type]), textarea');

      let type, options = [];
      if (radios.length) {
        type = "choice";
        options = radios.map(optionLabel).filter(Boolean);
      } else if (checks.length) {
        type = "checkbox";
        options = checks.map(optionLabel).filter(Boolean);
      } else if (listbox) {
        type = "dropdown";
        options = [...item.querySelectorAll('[role="option"]')].map(optionLabel).filter((o) => o && o !== "เลือก" && o !== "Choose");
      } else if (textInput) {
        type = textInput.tagName === "TEXTAREA" ? "paragraph" : "text";
      } else {
        return; // ข้ามข้อที่รองรับไม่ได้ (เช่น อัปโหลดไฟล์ ตารางกริด)
      }

      const index = questions.length + 1;
      const desc = heading.parentElement?.nextElementSibling;
      questionEls[index] = item;
      questions.push({
        index,
        type,
        title: clean(heading.textContent),
        description: desc && !desc.contains(textInput) ? clean(desc.textContent).slice(0, 500) : "",
        options
      });
    });
    return questions;
  }

  function setNativeValue(input, value) {
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillAnswer(ans) {
    const item = questionEls[ans.index];
    if (!item || ans.skip) return false;
    const wanted = ans.choices.map(clean);

    const radios = [...item.querySelectorAll('[role="radio"]')];
    if (radios.length) {
      const r = radios.find((el) => wanted.includes(optionLabel(el)));
      if (r && r.getAttribute("aria-checked") !== "true") r.click();
      return !!r;
    }
    const checks = [...item.querySelectorAll('[role="checkbox"]')];
    if (checks.length) {
      let any = false;
      checks.forEach((el) => {
        const should = wanted.includes(optionLabel(el));
        const is = el.getAttribute("aria-checked") === "true";
        if (should !== is) el.click();
        any = any || should;
      });
      return any;
    }
    const input = item.querySelector('input[type="text"], input:not([type]), textarea');
    if (input && ans.text) {
      setNativeValue(input, ans.text);
      return true;
    }
    return false; // dropdown: ให้ผู้ใช้เลือกเองตามคำตอบที่แสดง
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function getPanel() {
    let panel = document.getElementById("cfh-panel");
    if (panel) return panel;
    panel = el("div");
    panel.id = "cfh-panel";
    document.body.appendChild(panel);
    return panel;
  }

  function renderPanel(header, body) {
    const panel = getPanel();
    panel.replaceChildren();
    const top = el("div", "cfh-top");
    top.append(el("strong", null, header));
    const close = el("button", "cfh-close", "✕");
    close.onclick = () => panel.remove();
    top.append(close);
    panel.append(top, body);
  }

  function showAnswers(questions, answers) {
    const body = el("div", "cfh-body");
    const byIndex = Object.fromEntries(answers.map((a) => [a.index, a]));

    const fillAll = el("button", "cfh-btn cfh-primary", "✍️ กรอกคำตอบทั้งหมดลงฟอร์ม");
    fillAll.onclick = () => {
      const n = answers.filter(fillAnswer).length;
      fillAll.textContent = `✅ กรอกแล้ว ${n} ข้อ (ตรวจทานก่อนส่งนะ)`;
    };
    body.append(fillAll);

    questions.forEach((q) => {
      const a = byIndex[q.index];
      const card = el("div", "cfh-card");
      card.append(el("div", "cfh-q", `${q.index}. ${q.title}`));
      if (!a) {
        card.append(el("div", "cfh-exp", "ไม่มีคำตอบสำหรับข้อนี้"));
      } else if (a.skip) {
        card.append(el("div", "cfh-exp", `⏭️ ข้าม: ${a.explanation}`));
      } else {
        const ansText = a.choices.length ? a.choices.join(", ") : a.text;
        card.append(el("div", "cfh-ans", `คำตอบ: ${ansText}`));
        card.append(el("div", "cfh-exp", `💡 ${a.explanation}`));
        const btns = el("div", "cfh-row");
        const fill = el("button", "cfh-btn", "กรอกข้อนี้");
        fill.onclick = () => {
          fill.textContent = fillAnswer(a) ? "✅ กรอกแล้ว" : "เลือกเองในฟอร์มนะ";
        };
        const go = el("button", "cfh-btn", "ไปที่ข้อนี้");
        go.onclick = () => questionEls[q.index]?.scrollIntoView({ behavior: "smooth", block: "center" });
        btns.append(fill, go);
        card.append(btns);
      }
      body.append(card);
    });

    renderPanel(`🤖 Claude ตอบ ${answers.length} ข้อ`, body);
  }

  async function run() {
    const questions = extractQuestions();
    if (!questions.length) {
      renderPanel("⚠️ ไม่พบคำถาม", el("div", "cfh-body", "ไม่พบคำถามในหน้านี้ ลองเปิดหน้าที่มีคำถามของฟอร์ม"));
      return { ok: false, error: "ไม่พบคำถามในหน้านี้" };
    }
    renderPanel("⏳ Claude กำลังคิด...", el("div", "cfh-body", `กำลังส่ง ${questions.length} ข้อให้ Claude`));

    const formTitle = clean(document.querySelector('[role="heading"][aria-level="1"]')?.textContent || document.title);
    const res = await chrome.runtime.sendMessage({ type: "ASK_CLAUDE", questions, formTitle });
    if (!res?.ok) {
      renderPanel("❌ เกิดข้อผิดพลาด", el("div", "cfh-body", res?.error || "ไม่ทราบสาเหตุ"));
      return res;
    }
    showAnswers(questions, res.answers);
    return { ok: true, count: res.answers.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "RUN_HELPER") return;
    run()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  });
})();
