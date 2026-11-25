# EventFlow V3.0 活動與會員社群平台

Node.js 24+、Express、SQLite、Socket.IO。保留活動報名、候補、Email、QR／核銷、CSV、報表、多組織 RBAC 與備份，新增一般會員、個人中心、表單設計器、建立活動精靈、文字社群與站內通知。版本 3.0.0、schema 31。

```powershell
cd D:\Coding\EventFlow
npm ci
npm run check
npm test
npm start
```

啟動前先停止舊程序。前台 `http://localhost:3000`、會員 `/member.html`、社群 `/community.html`、後台 `/admin.html`、表單設計器 `/form-builder.html`、系統藍圖 `/blueprint.html`。直接修改專案，不打包 ZIP。

- [V3.0 設定與使用流程](README_V3.0.md)
- [API／Socket.IO 契約](API_V3.0.md) · [實際 ERD](ERD_V3.0.md)
- [完整開發與協作報告](PLATFORM_DEVELOPMENT_REPORT.md)
- [測試結果](TEST_RESULTS_V3.0.md) · [資安檢查](SECURITY_REVIEW_V3.0.md) · [QA](QA_REVIEW_V3.0.md)
- [更新紀錄](CHANGELOG.md) · [專案交接背景](PROJECT_CONTEXT.md)

Email 驗證與會員聊天需要可用 SMTP 及正確 PUBLIC_BASE_URL。未設定時顯示未寄送／preview，不公開驗證 Token，也不假裝完成驗證。一般會員註冊不取得後台權限；訪客報名及原編號＋查詢碼機制仍保留。

Migration 31 在一致性備份後增量執行，不清空舊資料。完整快照包括 SQLite、uploads 與郵件加密金鑰；還原只接受新目錄。Docker／Coolify 檔案保留；實際 SMTP、HTTPS、實體裝置與正式還原切換仍需操作者驗收。完整測試數以最終 TEST_RESULTS_V3.0.md 為準。
