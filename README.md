# EventFlow V2.9

Node.js 24+、Express、SQLite 的活動報名與管理平台。本機專案：D:\Coding\EventFlow。

先停止舊版程序，再執行：

```powershell
cd D:\Coding\EventFlow
npm ci
npm run check
npm test
npm start
```

前台 http://localhost:3000 · 後台 http://localhost:3000/admin.html · 系統藍圖 http://localhost:3000/blueprint.html 。不需 ZIP。

- [V2.9 操作、設定與還原程序](README_V2.9.md)
- [實際測試結果與人工驗收清單](TEST_RESULTS_V2.9.md)
- [更新紀錄](CHANGELOG.md)

首次啟動新版會自動備份 SQLite 並執行 migration 29；保留既有活動、報名、帳號、權限、QR 與簽到歷史。請先閱讀還原程序，正式資料不可用於破壞性測試。舊版文件僅供追溯，目前操作以 V2.9 文件為準。
