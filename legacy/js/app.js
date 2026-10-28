
"use strict";

const requestedEventId = new URLSearchParams(location.search).get("event");
const eventData = requestedEventId ? Storage.getEvent(requestedEventId) : Storage.getDefaultEvent();
if (!eventData || eventData.archived) {
  document.querySelector("main").textContent = "活動不存在或已封存，請返回活動列表。";
  throw new Error("活動不存在或已封存");
}
const form = document.getElementById("registrationForm");
const result = document.getElementById("result");
const submitButton = document.getElementById("submitButton");

const customFields = Array.isArray(eventData.customFields)
  ? eventData.customFields
  : [];

const customContainer = document.createElement("div");
customContainer.id = "customFieldsContainer";

const notesField = document.getElementById("notes")
  .closest(".field");

notesField.before(customContainer);

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function getRegisteredCount() {
  return Storage.getRegistrations()
    .filter(item =>
      item.eventId === eventData.id &&
      ["confirmed", "pending"].includes(item.status)
    )
    .reduce(
      (total, item) => total + Number(item.participants || 0),
      0
    );
}

function getRemaining() {
  return Math.max(0, eventData.capacity - getRegisteredCount());
}

function renderCustomFields() {
  customContainer.replaceChildren();

  for (const field of customFields) {
    if (field.visible === false) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "field";

    const label = document.createElement("label");
    label.htmlFor = "custom_" + field.id;
    label.textContent = field.label;

    if (field.required) {
      const required = document.createElement("em");
      required.textContent = " *";
      label.appendChild(required);
    }

    let input;

    if (field.type === "textarea") {
      input = document.createElement("textarea");
    } else if (field.type === "select") {
      input = document.createElement("select");

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "請選擇";
      input.appendChild(placeholder);

      for (const optionText of field.options || []) {
        const option = document.createElement("option");
        option.value = optionText;
        option.textContent = optionText;
        input.appendChild(option);
      }
    } else {
      input = document.createElement("input");
      input.type = ["text", "number", "date"].includes(field.type)
        ? field.type
        : "text";
    }

    input.id = "custom_" + field.id;
    input.name = input.id;
    input.required = !!field.required;

    if (field.type !== "date" && field.type !== "number") {
      input.maxLength = 500;
    }

    if (field.type === "number") {
      input.step = "any";
    }

    const error = document.createElement("small");
    error.className = "error";
    error.id = "customError_" + field.id;

    wrapper.append(label, input, error);
    customContainer.appendChild(wrapper);
  }
}

function updateCapacity() {
  const registered = getRegisteredCount();
  const remaining = getRemaining();

  setText("capacity", eventData.capacity + " 人");
  setText("registered", registered + " 人");
  setText("remaining", remaining + " 人");

  const percent = eventData.capacity > 0
    ? Math.min(100, registered / eventData.capacity * 100)
    : 100;

  document.getElementById("progressBar").style.width =
    percent + "%";

  const closed = eventData.status !== "open";

  setText(
    "availabilityText",
    closed ? "目前未開放報名" :
    remaining === 0 ? "目前名額已滿" :
    "目前開放報名中"
  );

  submitButton.disabled = closed || remaining === 0;
}

function renderEvent() {
  setText("eventTitle", eventData.title);
  setText("eventDescription", eventData.description);
  setText("eventDate", eventData.date);
  setText("eventLocation", eventData.location);

  setText(
    "eventPrice",
    eventData.price === 0
      ? "免費"
      : "NT$ " + eventData.price.toLocaleString()
  );

  const select = document.getElementById("participants");
  select.replaceChildren();

  for (let i = 1; i <= eventData.maxPerRegistration; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = i + " 人";
    select.appendChild(option);
  }

  renderCustomFields();
  updateCapacity();
}

function clearErrors() {
  for (const id of [
    "name", "phone", "email", "participants", "agree"
  ]) {
    setText(id + "Error", "");
  }

  for (const field of customFields) {
    const error = document.getElementById(
      "customError_" + field.id
    );
    if (error) error.textContent = "";
  }
}

function showResult(message, isError = false) {
  result.className = isError
    ? "result error-result"
    : "result";

  result.textContent = message;
}

function generateRegistrationId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return "REG-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 10);
}

form.addEventListener("submit", function(event) {
  event.preventDefault();
  clearErrors();

  result.className = "result hidden";

  const data = {
    name: Validation.normalizeName(
      document.getElementById("name").value
    ),
    phone: Validation.normalizePhone(
      document.getElementById("phone").value
    ),
    email: Validation.normalizeEmail(
      document.getElementById("email").value
    ),
    participants: Number(
      document.getElementById("participants").value
    ),
    notes: document.getElementById("notes").value.trim(),
    agree: document.getElementById("agree").checked
  };

  const answers = {};

  for (const field of customFields) {
    if (field.visible === false) continue;

    const input = document.getElementById(
      "custom_" + field.id
    );

    answers[field.id] = input.value.trim();
  }

  const registrations = Storage.getRegistrations();

  const errors = Validation.validate(
    data, eventData, registrations
  );

  const customErrors = Validation.validateCustomFields(
    customFields, answers
  );

  for (const [field, message] of Object.entries(errors)) {
    setText(field + "Error", message);
  }

  for (const [fieldId, message] of Object.entries(customErrors)) {
    const error = document.getElementById(
      "customError_" + fieldId
    );
    if (error) error.textContent = message;
  }

  if (
    Object.keys(errors).length > 0 ||
    Object.keys(customErrors).length > 0
  ) {
    showResult("資料檢查未通過，請確認紅色提示。", true);
    return;
  }

  if (eventData.status !== "open") {
    showResult("目前未開放報名。", true);
    return;
  }

  if (data.participants > getRemaining()) {
    showResult("剩餘名額不足，請調整報名人數。", true);
    return;
  }

  const registration = {
    id: generateRegistrationId(),
    eventId: eventData.id,
    name: data.name,
    phone: data.phone,
    email: data.email,
    participants: data.participants,
    notes: data.notes,
    customAnswers: answers,
    customFieldSnapshot: customFields.map(f => ({id:f.id,label:f.label,type:f.type})),
    status: eventData.reviewRequired ? "pending" : "confirmed",
    createdAt: new Date().toISOString()
  };

  registrations.push(registration);

  try {
    Storage.saveRegistrations(registrations);
  } catch {
    showResult("儲存失敗，請檢查瀏覽器儲存設定。", true);
    return;
  }

  showResult(
    (eventData.reviewRequired ? "已送出待審核，名額暫時保留。" : "報名已確認。") + "報名資料已儲存在本機！報名編號：" +
    registration.id +
    "。此為課堂示範，尚未送交真正的主辦單位。"
  );

  form.reset();
  updateCapacity();
});

renderEvent();
