
"use strict";

const settingsForm = document.getElementById("eventSettingsForm");
const tableBody = document.getElementById("registrationTableBody");

let activeEventId = new URLSearchParams(location.search).get("event") || Storage.getDefaultEvent()?.id;
function getEvent() { return Storage.getEvent(activeEventId); }
function saveCurrentEvent(event) { Storage.saveEvent(event); }


function getRegistrations() {
  const event = getEvent();
  return Storage.getRegistrations()
    .filter(item => item.eventId === event.id);
}

function confirmedRegistrations() {
  return getRegistrations()
    .filter(item => ["confirmed", "pending"].includes(item.status));
}

function registeredPeople() {
  return confirmedRegistrations()
    .reduce((sum, item) => sum + Number(item.participants || 0), 0);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function feedback(id, message, error = false) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.className = error ? "admin-feedback error" : "admin-feedback";
  el.hidden = false;
}

function updateDashboard() {
  const event = getEvent();
  const confirmed = confirmedRegistrations();
  const people = registeredPeople();

  setText("totalRegistrations", confirmed.length);
  setText("totalPeople", people);
  setText("remainingCapacity", Math.max(0, event.capacity - people));
}

function loadSettings() {
  const event = getEvent();
  const mapping = {
    settingTitle: event.title,
    settingDescription: event.description,
    settingDate: event.date,
    settingLocation: event.location,
    settingPrice: event.price,
    settingCapacity: event.capacity,
    settingMaxPeople: event.maxPerRegistration,
    settingStatus: event.status
  };

  for (const [id, value] of Object.entries(mapping)) {
    document.getElementById(id).value = value;
  }
}

function readSettings() {
  return {
    ...getEvent(),
    title: document.getElementById("settingTitle").value.trim(),
    description: document.getElementById("settingDescription").value.trim(),
    date: document.getElementById("settingDate").value,
    location: document.getElementById("settingLocation").value.trim(),
    price: Number(document.getElementById("settingPrice").value),
    capacity: Number(document.getElementById("settingCapacity").value),
    maxPerRegistration: Number(
      document.getElementById("settingMaxPeople").value
    ),
    status: document.getElementById("settingStatus").value
  };
}

function validateSettings(event) {
  if (!event.title || !event.description || !event.location) {
    return "活動名稱、介紹與地點不可空白。";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    return "請選擇活動日期。";
  }
  if (!Number.isInteger(event.price) ||
      event.price < 0 || event.price > 10000000) {
    return "活動費用必須是有效的非負整數。";
  }
  if (!Number.isInteger(event.capacity) ||
      event.capacity < 1 || event.capacity > 1000000) {
    return "活動名額必須是 1～1,000,000 的整數。";
  }
  if (!Number.isInteger(event.maxPerRegistration) ||
      event.maxPerRegistration < 1 ||
      event.maxPerRegistration > 100) {
    return "單筆報名上限必須是 1～100 的整數。";
  }
  if (event.capacity < registeredPeople()) {
    return "總名額不可小於已確認報名人數。";
  }
  if (!["open", "closed"].includes(event.status)) {
    return "報名狀態不正確。";
  }
  return null;
}

settingsForm.addEventListener("submit", e => {
  e.preventDefault();
  const event = readSettings();
  const error = validateSettings(event);

  if (error) {
    feedback("settingsFeedback", error, true);
    return;
  }

  try {
    saveCurrentEvent(event);
    updateDashboard(); refreshEventSelect(); renderEventsList();
    feedback("settingsFeedback", "活動設定已儲存。");
  } catch {
    feedback("settingsFeedback", "儲存失敗。", true);
  }
});

document.getElementById("resetSettingsButton")
  .addEventListener("click", () => {
    if (DEFAULT_EVENT.capacity < registeredPeople()) {
      feedback(
        "settingsFeedback",
        "預設名額小於已報名人數，無法恢復。",
        true
      );
      return;
    }

    if (!confirm("恢復活動基本設定？自訂欄位會保留。")) return;

    const event = {
      ...getEvent(),
      title: DEFAULT_EVENT.title,
      description: DEFAULT_EVENT.description,
      date: DEFAULT_EVENT.date,
      location: DEFAULT_EVENT.location,
      price: DEFAULT_EVENT.price,
      capacity: DEFAULT_EVENT.capacity,
      maxPerRegistration: DEFAULT_EVENT.maxPerRegistration,
      status: DEFAULT_EVENT.status
    };

    try {
      saveCurrentEvent(event);
      loadSettings();
      updateDashboard();
      feedback("settingsFeedback", "基本設定已恢復。");
    } catch {
      feedback("settingsFeedback", "儲存失敗。", true);
    }
  });

document.querySelectorAll(".admin-tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab")
      .forEach(tab => tab.classList.remove("active"));

    document.querySelectorAll(".admin-panel")
      .forEach(panel => panel.classList.remove("active"));

    button.classList.add("active");
    document.getElementById(button.dataset.panel)
      .classList.add("active");

    if (button.dataset.panel === "registrationsPanel") {
      renderRegistrations();
    }
  });
});

// ---------- 動態表單設計器 ----------

let draftFields = JSON.parse(JSON.stringify(
  getEvent().customFields || []
));

function newFieldId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return "field_" + crypto.randomUUID().replace(/-/g, "");
  }
  return "field_" + Date.now() + "_" +
    Math.random().toString(36).slice(2, 10);
}

function createField() {
  draftFields.push({
    id: newFieldId(),
    label: "新欄位",
    type: "text",
    required: false,
    visible: true,
    options: []
  });

  renderFieldEditor();
}

function makeEditorInput(labelText, value, onChange, type = "text") {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = type;
  input.value = value;

  input.addEventListener("input", () => onChange(input.value));

  wrapper.append(label, input);
  return wrapper;
}

function makeButton(text, callback) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-outline";
  button.textContent = text;
  button.addEventListener("click", callback);
  return button;
}

function renderFieldEditor() {
  const container = document.getElementById("fieldEditorList");
  container.replaceChildren();

  draftFields.forEach((field, index) => {
    const card = document.createElement("div");
    card.className = "field-editor";

    const heading = document.createElement("h3");
    heading.textContent = `欄位 ${index + 1}`;
    card.appendChild(heading);

    card.appendChild(makeEditorInput(
      "欄位名稱",
      field.label,
      value => {
        field.label = value;
        renderFieldsPreview();
      }
    ));

    const typeWrapper = document.createElement("div");
    typeWrapper.className = "field";

    const typeLabel = document.createElement("label");
    typeLabel.textContent = "欄位類型";

    const typeSelect = document.createElement("select");

    for (const [type, name] of Object.entries(FIELD_TYPES)) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = name;
      typeSelect.appendChild(option);
    }

    typeSelect.value = field.type;

    typeSelect.addEventListener("change", () => {
      field.type = typeSelect.value;
      renderFieldEditor();
    });

    typeWrapper.append(typeLabel, typeSelect);
    card.appendChild(typeWrapper);

    if (field.type === "select") {
      card.appendChild(makeEditorInput(
        "選項（使用逗號分隔）",
        (field.options || []).join(","),
        value => {
          field.options = value.split(",")
            .map(v => v.trim())
            .filter(Boolean);
          renderFieldsPreview();
        }
      ));
    }

    for (const [key, text] of [
      ["required", "必填欄位"],
      ["visible", "顯示欄位"]
    ]) {
      const row = document.createElement("div");
      row.className = "checkbox-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = field[key];

      checkbox.addEventListener("change", () => {
        field[key] = checkbox.checked;
        renderFieldsPreview();
      });

      const label = document.createElement("label");
      label.textContent = text;

      row.append(checkbox, label);
      card.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "field-actions";

    actions.append(
      makeButton("上移", () => moveField(index, -1)),
      makeButton("下移", () => moveField(index, 1)),
      makeButton("刪除", () => deleteField(index))
    );

    card.appendChild(actions);
    container.appendChild(card);
  });

  renderFieldsPreview();
}

function moveField(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= draftFields.length) return;

  [draftFields[index], draftFields[target]] =
    [draftFields[target], draftFields[index]];

  renderFieldEditor();
}

function deleteField(index) {
  if (!confirm("確定刪除此欄位？既有報名答案不會自動清除。")) {
    return;
  }

  draftFields.splice(index, 1);
  renderFieldEditor();
}

function renderFieldsPreview() {
  const container = document.getElementById("fieldsPreview");
  container.replaceChildren();

  const visible = draftFields.filter(field => field.visible);

  if (visible.length === 0) {
    container.textContent = "目前沒有顯示中的自訂欄位。";
    return;
  }

  for (const field of visible) {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-item";

    const label = document.createElement("label");
    label.textContent = field.label + (field.required ? " *" : "");

    let input;

    if (field.type === "textarea") {
      input = document.createElement("textarea");
    } else if (field.type === "select") {
      input = document.createElement("select");

      for (const value of field.options || []) {
        const option = document.createElement("option");
        option.textContent = value;
        option.value = value;
        input.appendChild(option);
      }
    } else {
      input = document.createElement("input");
      input.type = field.type;
    }

    input.disabled = true;
    wrapper.append(label, input);
    container.appendChild(wrapper);
  }
}

function validateDraftFields() {
  const labels = new Set();
  const ids = new Set();

  if (draftFields.length > 30) {
    return "最多只能建立 30 個自訂欄位。";
  }

  for (const field of draftFields) {
    field.label = field.label.trim();

    if (!field.label || field.label.length > 60) {
      return "欄位名稱不可空白，且最多 60 字。";
    }

    if (!Object.hasOwn(FIELD_TYPES, field.type)) {
      return "存在不支援的欄位類型。";
    }

    if (labels.has(field.label)) {
      return "欄位名稱不可重複：" + field.label;
    }

    if (ids.has(field.id)) {
      return "欄位識別碼重複。";
    }

    labels.add(field.label);
    ids.add(field.id);

    if (field.type === "select") {
      if (!field.options || field.options.length === 0) {
        return `「${field.label}」需要至少一個選項。`;
      }

      if (new Set(field.options).size !== field.options.length) {
        return `「${field.label}」的選項不可重複。`;
      }
    }
  }

  return null;
}

document.getElementById("addFieldButton")
  .addEventListener("click", () => {
    if (draftFields.length >= 30) {
      feedback("fieldsFeedback", "最多 30 個欄位。", true);
      return;
    }
    createField();
  });

document.getElementById("saveFieldsButton")
  .addEventListener("click", () => {
    const error = validateDraftFields();

    if (error) {
      feedback("fieldsFeedback", error, true);
      return;
    }

    const event = getEvent();

    event.customFields = JSON.parse(JSON.stringify(draftFields));

    try {
      saveCurrentEvent(event);
      feedback(
        "fieldsFeedback",
        "表單設計已儲存！前台重新整理後即可套用。"
      );
      renderFieldEditor();
    } catch {
      feedback("fieldsFeedback", "儲存失敗。", true);
    }
  });

// ---------- 報名名單 ----------

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-TW");
}

function makeCell(row, value) {
  const td = document.createElement("td");
  td.textContent = String(value ?? "");
  row.appendChild(td);
  return td;
}

function getCustomAnswerText(item) {
  const answers = item.customAnswers || {};
  const fields = item.customFieldSnapshot || getEvent().customFields || [];

  const lines = [];

  for (const field of fields) {
    if (Object.hasOwn(answers, field.id)) {
      lines.push(
        field.label + "：" + String(answers[field.id] || "—")
      );
    }
  }

  return lines.join("\n") || "—";
}

function renderRegistrations() {
  const keyword = document.getElementById("searchInput")
    .value.trim().toLowerCase();

  const status = document.getElementById("statusFilter").value;

  let items = getRegistrations().filter(item => {
    const matchStatus =
      status === "all" || item.status === status;

    const searchable = [
      item.id, item.name, item.phone, item.email
    ].join(" ").toLowerCase();

    return matchStatus && searchable.includes(keyword);
  });

  items.sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  tableBody.replaceChildren();

  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "目前沒有符合條件的報名資料。";
    tr.appendChild(td);
    tableBody.appendChild(tr);
  }

  for (const item of items) {
    const tr = document.createElement("tr");

    makeCell(tr, formatDate(item.createdAt));
    makeCell(tr, item.name);
    makeCell(tr, item.phone);
    makeCell(tr, item.email);
    makeCell(tr, item.participants + " 人");
    makeCell(tr, item.notes || "—");

    const customCell = makeCell(tr, getCustomAnswerText(item));
    customCell.style.whiteSpace = "pre-line";

    makeCell(
      tr,
      ({cancelled:"已取消",confirmed:"已確認",pending:"待審核",rejected:"已拒絕"}[item.status] || item.status)
    );

    const actionCell = document.createElement("td");

    if (["confirmed", "pending"].includes(item.status)) {
      const button = makeButton("取消報名", () => {
        cancelRegistration(item.id);
      });
      actionCell.appendChild(button);
    } else {
      actionCell.textContent = "—";
    }

    tr.appendChild(actionCell);
    tableBody.appendChild(tr);
  }

  setText("listCount", `目前顯示 ${items.length} 筆紀錄`);
}

function cancelRegistration(id) {
  if (!confirm("確定取消這筆報名？")) return;

  const all = Storage.getRegistrations();
  const target = all.find(item =>
    item.id === id && item.eventId === getEvent().id
  );

  if (!target || !["confirmed", "pending"].includes(target.status)) {
    feedback("listFeedback", "找不到可取消的紀錄。", true);
    return;
  }

  target.status = "cancelled";
  target.cancelledAt = new Date().toISOString();

  try {
    Storage.saveRegistrations(all);
    Storage.audit("取消報名",id);
    updateDashboard();
    renderRegistrations();
    feedback("listFeedback", "已取消報名並釋放名額。");
  } catch {
    feedback("listFeedback", "取消失敗。", true);
  }
}

document.getElementById("searchInput")
  .addEventListener("input", renderRegistrations);

document.getElementById("statusFilter")
  .addEventListener("change", renderRegistrations);

function csvEscape(value) {
  let text = String(value ?? "");

  if (/^\s*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return '"' + text.replace(/"/g, '""') + '"';
}

function exportCSV() {
  const items = getRegistrations();

  if (items.length === 0) {
    feedback("listFeedback", "沒有可匯出的紀錄。", true);
    return;
  }

  const fieldsById = new Map();
  for (const field of getEvent().customFields || []) fieldsById.set(field.id, field);
  for (const item of items) for (const field of item.customFieldSnapshot || []) {
    if (!fieldsById.has(field.id)) fieldsById.set(field.id, field);
  }
  const fields = [...fieldsById.values()];

  const headers = [
    "報名編號", "報名時間", "姓名", "手機",
    "Email", "人數", "特殊需求", "狀態", "審核備註",
    ...fields.map(field => field.label)
  ];

  const rows = [headers];

  for (const item of items) {
    rows.push([
      item.id,
      item.createdAt,
      item.name,
      item.phone,
      item.email,
      item.participants,
      item.notes || "",
      ({cancelled:"已取消",confirmed:"已確認",pending:"待審核",rejected:"已拒絕"}[item.status] || item.status),
      ...fields.map(field =>
        item.customAnswers?.[field.id] ?? ""
      )
    ]);
  }

  const csv = "\uFEFF" + rows
    .map(row => row.map(csvEscape).join(","))
    .join("\r\n");

  const blob = new Blob(
    [csv],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "EventFlow_V1.3_報名名單.csv";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

document.getElementById("exportButton")
  .addEventListener("click", exportCSV);

loadSettings();
updateDashboard();
renderFieldEditor();
renderRegistrations();

// ---------- V1.2 多活動 ----------
function refreshEventSelect() {
  const select = document.getElementById("activeEventSelect");
  select.replaceChildren();
  for (const event of Storage.getEvents()) {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = event.title + (event.archived ? "（已封存）" : "");
    select.appendChild(option);
  }
  select.value = activeEventId;
}
function switchEvent(id) {
  if (!Storage.getEvent(id)) return;
  activeEventId = id;
  history.replaceState(null, "", "admin.html?event=" + encodeURIComponent(id));
  draftFields = JSON.parse(JSON.stringify(getEvent().customFields || []));
  loadSettings(); updateDashboard(); renderFieldEditor(); renderRegistrations();
  refreshEventSelect(); renderEventsList();
}
function renderEventsList() {
  const list = document.getElementById("eventsList");
  list.replaceChildren();
  for (const event of Storage.getEvents()) {
    const item = document.createElement("div");
    item.className = "field-editor";
    const title = document.createElement("h3");
    const count = Storage.getRegistrations().filter(r => r.eventId === event.id && ["confirmed", "pending"].includes(r.status))
      .reduce((sum, r) => sum + Number(r.participants || 0), 0);
    title.textContent = event.title + (event.archived ? "（已封存）" : "");
    const desc = document.createElement("p");
    desc.textContent = `${event.date} · ${count}/${event.capacity} 人 · ${event.status === "open" ? "開放" : "關閉"}`;
    const actions = document.createElement("div"); actions.className = "field-actions";
    actions.append(
      makeButton("管理", () => switchEvent(event.id)),
      makeButton("複製", () => {
        const copy = JSON.parse(JSON.stringify(event));
        copy.id = newEventId(); copy.title += "（複製）"; copy.archived = false;
        copy.customFields = (copy.customFields || []).map(f => ({...f, id:newEventId()}));
        saveCurrentEvent(copy); Storage.audit("複製活動",copy.title); refreshEventSelect(); renderEventsList(); switchEvent(copy.id);
      }),
      makeButton(event.archived ? "解除封存" : "封存", () => {
        saveCurrentEvent({...event, archived:!event.archived, status:event.archived ? "closed" : "closed"}); Storage.audit("切換封存",event.title);
        refreshEventSelect(); renderEventsList(); updateDashboard();
      })
    );
    const link = document.createElement("a");
    link.href = "index.html?event=" + encodeURIComponent(event.id);
    link.textContent = "報名連結";
    actions.appendChild(link);
    item.append(title,desc,actions); list.appendChild(item);
  }
}
function newEventId() {
  return "event_" + (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : Date.now().toString(36) + Math.random().toString(36).slice(2));
}
const templateSelect = document.getElementById("newEventTemplate");
for (const [key, template] of Object.entries(EVENT_TEMPLATES)) {
  const option = document.createElement("option"); option.value = key; option.textContent = template.name;
  templateSelect.appendChild(option);
}
document.getElementById("createEventButton").addEventListener("click", () => {
  const title = document.getElementById("newEventTitle").value.trim();
  if (!title) { feedback("eventsFeedback", "請先輸入活動名稱。", true); return; }
  const event = {...DEFAULT_EVENT, id:newEventId(), title, status:"closed", archived:false,
    customFields:templateFields(templateSelect.value)};
  try { saveCurrentEvent(event); Storage.audit("建立活動",title); document.getElementById("newEventTitle").value = "";
    refreshEventSelect(); renderEventsList(); switchEvent(event.id);
    feedback("eventsFeedback", "活動已建立，請至活動設定修改日期、地點及開放狀態。");
  } catch { feedback("eventsFeedback", "活動建立失敗。", true); }
});
document.getElementById("activeEventSelect").addEventListener("change", e => switchEvent(e.target.value));
if (!getEvent()) activeEventId = Storage.getDefaultEvent()?.id;
refreshEventSelect(); renderEventsList();
