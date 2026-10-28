
const Validation = {
  normalizeName(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  },

  normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  },

  normalizePhone(value) {
    let phone = String(value || "").replace(/[\s()-]/g, "");
    if (phone.startsWith("+886")) {
      phone = "0" + phone.slice(4);
    }
    return phone;
  },

  validate(data, event, registrations) {
    const errors = {};

    if (!data.name) {
      errors.name = "請填寫姓名";
    } else if (data.name.length > 60) {
      errors.name = "姓名不可超過 60 字";
    }

    if (!/^09\d{8}$/.test(data.phone)) {
      errors.phone = "請輸入正確的台灣手機號碼";
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ||
      data.email.length > 254
    ) {
      errors.email = "請輸入正確的 Email";
    }

    if (
      !Number.isInteger(data.participants) ||
      data.participants < 1 ||
      data.participants > event.maxPerRegistration
    ) {
      errors.participants = "報名人數不符合規則";
    }

    if (!data.agree) {
      errors.agree = "請確認資料使用說明";
    }

    const duplicate = registrations.some(item =>
      item.eventId === event.id &&
      item.status !== "cancelled" &&
      (
        item.phone === data.phone ||
        item.email === data.email
      )
    );

    if (duplicate) {
      errors.phone = "此手機或 Email 已有報名紀錄";
    }

    return errors;
  },

  validateCustomFields(fields, answers) {
    const errors = {};

    for (const field of fields) {
      if (field.visible === false) continue;

      const value = String(answers[field.id] ?? "").trim();

      if (field.required && !value) {
        errors[field.id] = `請填寫「${field.label}」`;
        continue;
      }

      if (!value) continue;

      if (value.length > 500) {
        errors[field.id] = "內容不可超過 500 字";
        continue;
      }

      if (field.type === "number") {
        if (!Number.isFinite(Number(value))) {
          errors[field.id] = "請輸入有效數字";
        }
      }

      if (field.type === "date") {
        const date = new Date(value);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        ) {
          errors[field.id] = "請輸入有效日期";
        }
      }

      if (field.type === "select") {
        const options = Array.isArray(field.options)
          ? field.options
          : [];

        if (!options.includes(value)) {
          errors[field.id] = "請選擇有效選項";
        }
      }
    }

    return errors;
  }
};
