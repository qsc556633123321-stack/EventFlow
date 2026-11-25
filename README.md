# EventFlow V3.0

Node.js 24+、Express、SQLite 活動報名與管理平台。本機專案：D:\Coding\EventFlow。

先停止舊服務，再執行：

```powershell
cd D:\Coding\EventFlow
npm ci
npm run check
npm test
npm start
```

前台 http://localhost:3000 · 後台 http://localhost:3000/admin.html · 藍圖 http://localhost:3000/blueprint.html 。不需 ZIP。

- [V3.0 操作與相容性](README_V3.0.md)
- [完整測試與待人工驗收](TEST_RESULTS_V3.0.md)
- [多代理協作及開發報告](V3_COLLABORATION.md)
- [資安檢查](SECURITY_REVIEW_V3.0.md) · [QA 檢查](QA_REVIEW_V3.0.md)
- [API／Schema 協作契約](V3_CONTRACT.json) · [更新紀錄](CHANGELOG.md)

V3.0 實作多組織會員與有效角色切換、既有帳號接受新組織邀請、報名重送恢復與優先 UX 修正。SQLite migration 30 先一致性備份，再交易增量升級；保留既有活動、報名、帳號、組織、QR 與簽到。舊版說明保留作歷史；完整還原操作另見 V3.0 文件中的版本及環境設定說明。
