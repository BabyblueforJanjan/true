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

  // พิมพ์ข้อความแบบเดียวกับผู้ใช้พิมพ์ เพื่อให้ Google Form รับรู้ค่า
  function typeText(input, value) {
    input.focus();
    input.select();
    const typed = document.execCommand("insertText", false, value);
    if (!typed || input.value !== value) {
      const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
    return input.value === value;
  }

  // คลิกแบบครบทุก event (Google Form ฟัง mousedown/mouseup ด้วย ไม่ใช่แค่ click)
  function realClick(target) {
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    target.dispatchEvent(new PointerEvent("pointerdown", opts));
    target.dispatchEvent(new MouseEvent("mousedown", opts));
    target.dispatchEvent(new PointerEvent("pointerup", opts));
    target.dispatchEvent(new MouseEvent("mouseup", opts));
    target.dispatchEvent(new MouseEvent("click", opts));
  }

  const isChecked = (el) => el.getAttribute("aria-checked") === "true";

  function setChecked(el, want) {
    if (isChecked(el) === want) return true;
    realClick(el);
    if (isChecked(el) !== want) el.click(); // สำรอง ถ้าคลิกแบบแรกไม่ติด
    return isChecked(el) === want;
  }

  // เทียบข้อความตัวเลือกแบบยืดหยุ่น (ไม่สนตัวพิมพ์ เว้นวรรค และคำนำหน้าแบบ "A." "ก)")
  function norm(s) {
    return clean(s).toLowerCase().replace(/^([a-z]|[ก-ฮ]|\d+)\s*[.)]\s+/, "");
  }

  function matchOption(els, choice) {
    const c = norm(choice);
    if (!c) return null;
    return els.find((el) => norm(optionLabel(el)) === c) ||
      els.find((el) => {
        const o = norm(optionLabel(el));
        return o && (o.includes(c) || c.includes(o));
      }) || null;
  }

  function fillAnswer(ans) {
    const item = questionEls[ans.index];
    if (!item || ans.skip) return false;

    const radios = [...item.querySelectorAll('[role="radio"]')];
    if (radios.length) {
      const r = matchOption(radios, ans.choices[0]);
      return !!r && setChecked(r, true);
    }
    const checks = [...item.querySelectorAll('[role="checkbox"]')];
    if (checks.length) {
      const targets = ans.choices.map((c) => matchOption(checks, c)).filter(Boolean);
      if (!targets.length) return false;
      return checks.map((el) => setChecked(el, targets.includes(el))).every(Boolean);
    }
    const input = item.querySelector('input[type="text"], input:not([type]), textarea');
    if (input && ans.text) return typeText(input, ans.text);
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

    const fillAll = el("button", "cfh-btn cfh-primary", "กรอก");
    const fillMsg = el("div", "cfh-exp");
    fillAll.onclick = () => {
      const todo = answers.filter((a) => !a.skip);
      const failed = todo.filter((a) => !fillAnswer(a)).map((a) => a.index);
      fillAll.textContent = `✅ กรอกแล้ว ${todo.length - failed.length}/${todo.length} ข้อ (ตรวจทานก่อนส่งนะ)`;
      fillMsg.textContent = failed.length ? `⚠️ กรอกไม่ได้: ข้อ ${failed.join(", ")} — ดูคำตอบใน "ดูคำอธิบาย" แล้วเลือกเอง` : "";
    };

    const details = el("div", "cfh-details");
    details.hidden = true;
    const toggle = el("button", "cfh-toggle", "ดูคำอธิบาย ▾");
    toggle.onclick = () => {
      details.hidden = !details.hidden;
      toggle.textContent = details.hidden ? "ดูคำอธิบาย ▾" : "ซ่อนคำอธิบาย ▴";
    };
    body.append(fillAll, fillMsg, toggle, details);

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
      details.append(card);
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
