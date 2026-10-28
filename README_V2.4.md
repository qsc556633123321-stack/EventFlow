# EventFlow V2.4

## 更新
- 報名建立、審核通過、拒絕、取消後建立通知紀錄。
- SMTP 未設定時使用安全預覽模式，不會寄送真實 Email。
- SMTP 啟用時每 30 秒處理通知，失敗採退避重試，最多 5 次。
- 管理員可透過 `/api/admin/notifications` 查看通知，POST `/api/admin/notifications/:id/retry` 手動重試。
- 系統藍圖第 07 節同步更新。

## 執行
`npm install` 後 `npm start`，開啟 http://localhost:3000。

## SMTP 設定（選用）
設定環境變數 `SMTP_HOST`, `SMTP_PORT`（預設 587）, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`，必要時 `SMTP_SECURE=1`（通常用於 465）。勿將密碼寫進前端或提交 Git。

## 注意
- 未設定 SMTP 時新通知標記為 preview；啟用 SMTP 後可經管理 API 手動重試。
- 此版排程為每 30 秒處理通知佇列，尚未包含活動前一天的定時提醒。
- 升級前備份 data/ 目錄；SQLite 以新增資料表方式升級。
