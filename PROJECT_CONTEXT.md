# EventFlow 專案交接背景

更新日期：2026-11-25。這是實際程式交接資料，不是未完成工作自動執行指令。

## 版本與位置

- 正式本機：`D:\Coding\EventFlow`。
- 本輪隔離副本：`C:\Users\User\Documents\ChatGPT\KUHUB\eventflow-platform-work`。
- Repository：`qsc556633123321-stack/EventFlow`，分支 `codex/eventflow-v3.0`。
- 起點 `919443a` 已有 schema 30 多組織成果；檢查 main `d27663b` 的 Docker／Coolify 檔案後保留，不直接合併 main。
- 版本 3.0.0、增量 schema 31。V2.9 與前次 schema30 文件只供歷史，不是本輪全貌。

## 實際模組

| 模組 | 責任 |
| --- | --- |
| server.js | Express／HTTP／Socket.IO 接線、原活動與報表、共享服務 |
| database.js／maintenance.js | 增量遷移、一致性備份、快照驗證及新目錄還原 |
| security.js／policy.js | 後台 Session、來源／CSRF、有效組織與逐活動 RBAC |
| member-platform.js | 一般會員、profile、驗證／重設、個人報名、通知與偏好 |
| chat.js | 公共／活動／私人房間、歷史、即時事件、隱私／檢舉與管理 |
| forms.js／form-schema.js | 組織範本、共享欄位／答案／設定驗證 |
| platform-admin.js | 精靈發布、真實 Dashboard、活動變動與提醒 |
| registrations.js／mail.js | 名額／候補／審核交易、會員關聯、冪等、SMTP 與加密會員郵件 |
| platform-events.js | 同程序通知與 Session 變更事件，不是外部工作佇列 |

一般會員與後台共用 users，audience 與 Cookie 分開。一般註冊無 organization_membership，member cookie 不能進後台；明確有效邀請才新增組織資格。停用公開 profile 不順帶停用原管理身份。

## 必須保護的相容性

活動 JSON keys、訪客報名、查詢碼、EF25 QR／核銷、自訂欄位與 field_snapshot、FIFO 整組候補、逐活動授權、三類 CSV、報表、稽核、SMTP 及完整快照保留。多選／同意為 additive 型別；新精靈不能刪除舊 open API 相容路徑。

會員自己的報名由 member_user_id 查詢。舊訪客須已驗證 Email＋報名編號／查詢碼綁定，不得 Email-only 自動認領。profile 不覆寫當時報名內容。

## 限制與交接

真實 SMTP／退信、HTTPS／Coolify、實體 QR 相機、裝置／無障礙、正式還原切換、負載與滲透需另驗收。SMTP accepted 不是 delivered，preview 不是寄出。profile 停用／刪除採軟申請，未提供永久移除審批。DM closed 僅擋新對話，block 才擋既有雙方；拒絕後未提供重申請。

沒有語音／視訊、離線核銷、付款、端到端加密、多節點 Socket adapter、共享限流或異地加密備份。個人偏好目前控制站內通知，不等於 SMTP 退訂；未提供任意更改登入 Email。

最終測試數、正式來源遷移狀態、階段 Commit 與 push 依 TEST_RESULTS_V3.0.md、PLATFORM_DEVELOPMENT_REPORT.md 及主代理交付，不沿用前次 24 項。


安全補充：modules/identity-security.js 統一共享身份密碼變更的撤銷；後台／會員重設、會員變更密碼及 owner 設密碼皆撤銷兩種 Session 與所有未使用 reset 連結。個人停用／刪除只更新 profile 請求狀態，不自動抹除歷史；實際刪除處理與恢復由管理維運流程執行。
