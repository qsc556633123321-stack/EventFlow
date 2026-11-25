# EventFlow V3.0 操作與相容性

本版日期：2026-11-25。Node.js 24+、Express、SQLite；以 V2.9 提交 `5d4458a` 為基底。前後台版本為 3.0.0，資料庫 schema 30。開發分支 `codex/eventflow-v3.0`，不需要 ZIP。

## 啟動與升級

```powershell
cd D:\Coding\EventFlow
npm run check
npm test
npm start
```

先停止舊服務，再啟動新版。依賴沒有新增；首次下載仍需 `npm ci`。前台 `http://localhost:3000`、後台 `/admin.html`、藍圖 `/blueprint.html`。本次開發測試用隔離資料，程式安裝不主動啟動正式資料庫的 migration；首次使用正式資料啟動 V3.0 才升級。請依本機實際 schema 與 TEST_RESULTS_V3.0.md 的交付檢查結果判斷。

Migration 30 在修改前以 SQLite 一致性備份產生 `data/migration-backups/pre-v30-*.sqlite`，交易建立新資料表／索引／Trigger，外鍵與完整性通過後提交。重複啟動不重複遷移或再備份。高於 schema 30 的資料庫拒絕啟動。從更早版本升級時沿用既有 27～29 遷移規則；不清空活動或報名資料。

## 同一帳號加入多個組織

- `organization_memberships` 以 `(user_id, organization_id)` 唯一識別資格，各自記錄 `admin/staff`、`active/suspended` 與工作人員授權模式。
- 舊帳號回填原組織資格；原 `users.role`、`organization_id`、`staff_mode` 保留相容，不搬移原資料。平台 owner 的原組織回填 admin 資格，但平台 owner 身份仍由 `users.role=owner` 決定。
- 非 owner 登入後優先選擇有效原組織，否則選擇第一個有效資格。在後台「工作範圍」切換組織，角色與可用活動跟著變更；同人可在 A 是管理員、B 是工作人員。
- 每次 API 請求重新驗證目前 Session 的有效資格。暫停資格或平台停用後，不能靠舊畫面或舊角色繼續存取。所有資格均暫停時無法登入，需先由管理員恢復有效資格，才能登入接受另一組織邀請；目前沒有獨立的「只驗證身份、不提供組織存取」登入模式。
- 工作人員的逐活動審核、QR 核銷與 CSV 授權仍各自生效。跨組織資料不因同帳號擁有另一個資格而混合顯示。

## 邀請與資格管理

「成員與權限」可邀請尚未加入本組織的既有 Email。既有帳號必須以同一帳號登入、通過 CSRF 後接受邀請，不要求重設密碼，不變更原組織、其他資格或其他組織的活動授權。新帳號仍透過一次性邀請設定密碼。連結 48 小時有效，接受時再次驗證邀請者現有權限，使用後即失效。

新邀請的 staff 預設 assigned，沒有活動授權；管理員必須再授權。後台提供待授權提示。管理員只能管理本組織 staff，不能藉邀請或編輯升為管理員。

成員表的「停用此組織資格」僅暫停該 membership；其他組織的資料與授權保留。平台 owner 在「所有組織」範圍另可停用整個帳號及變更既有密碼，此為影響所有組織的全域動作，撤銷所有 Session。一般資格異動撤銷該組織 Session；其他組織登入不因無關資格異動被搬移。

編輯既有成員不得直接改到不存在的 membership。要加入新組織應走邀請，而不是隱性搬移帳號。平台全域清單可能為同帳號列出多個組織資格，請以每列組織識別操作目標。

## API 相容與新增欄位

| 介面 | V3.0 行為 |
| --- | --- |
| `GET /api/me` | 保留舊 keys，新增 `platformRole`、`memberships`；`role` 為目前有效角色 |
| `POST /api/admin/context` | 保留 `{organizationId}` 與 `{ok:true}`；非 owner 只能切換自己 active 資格，owner 保留全域／指定組織 |
| `GET /api/admin/users` | 仍為陣列，資格列新增 `platformRole`、`membershipStatus`、`globalDisabled`；既有角色／組織欄位對應該列資格 |
| `PUT /api/admin/users/:id` | `organizationId` 指定既有資格；`disabled` 為該資格暫停；`globalDisabled`、既有帳號 `password` 只允許全域 owner |
| `POST /api/users` | 新帳號同交易建立資格；保留舊 API 未傳 `staffMode` 的 organization 預設，新 UI 與邀請明確使用 assigned |
| 邀請 info | 新增 `requiresLogin`，既有帳號接受時須匹配 Session 與 CSRF；新帳號保留 token/password 流程 |
| 活動、報名、QR、CSV、報表 | 保留舊路徑與原 JSON keys；依目前有效角色及組織隔離 |

`disabled` 在成員編輯的範圍語意已明確為「組織資格」，全平台狀態請使用 `globalDisabled`。舊單組織帳號的組織停用仍會阻止其唯一資格登入，但多組織帳號不應因此失去其他資格。

## 報名重送與錯誤復原

前台為一次報名產生隨機識別碼，以 `Idempotency-Key` 傳送。相同完整內容重試沿用同一 key，內容改變則換 key。伺服器在同一 SQLite 寫入交易建立報名及 `registration_requests` 映射，只儲存 key 與 canonical payload 的 SHA-256，不儲存完整請求副本。

- 同一活動、key、完整內容在 24 小時內重送，回傳原報名編號、目前狀態與原查詢碼，不重複占位或排入通知；活動後來滿額／關閉也能恢復原結果。
- 不同活動、不同內容或逾期 key 回傳 409，不另建報名。過期映射目前不自動清理，以免同一 key 被誤用重新建立。
- 未帶 header 的舊 API 行為保留，仍阻擋手機／Email 重複有效報名。
- 重試 key 與未送出表單目前只在原分頁記憶體保存；重新整理、關閉分頁或換裝置後，尚無安全的自助查詢碼找回。請保存結果頁編號／查詢碼及有效憑證。

前台保留搜尋、分類、排序、組織來源及返回入口，補上報名摘要、結果保存提醒與身份切換清理。報名 pending／waitlisted 仍不代表正式錄取；QR 核發及重複核銷由後端驗證。顯示價格不代表已完成線上付款，本版沒有支付系統。

## 備份、還原與部署界線

保留 V2.9 完整快照：SQLite、uploads、帳號郵件金鑰與檔案雜湊清單。schema 30 快照增加會員筆數及必要資料表／報名映射關聯檢查；仍可驗證舊 schema 29 快照。完整快照會保存所有組織資格。

```powershell
npm run maintenance -- backup
npm run maintenance -- verify --backup '完整快照的絕對路徑'
npm run maintenance -- restore --backup '完整快照的絕對路徑' --target '不存在的新目錄絕對路徑'
```

還原前先停止服務並保留目前資料；禁止覆蓋現有正式目錄。工具驗證來源後還原到全新目錄，保留會員／活動／報名／QR／簽到，撤銷 Session 與未使用帳號連結，暫停待送通知以避免重寄。以相容原始碼、`EVENTFLOW_DATA_DIR`、`EVENTFLOW_UPLOADS_DIR`、另一測試 Port、停用 SMTP 做新副本驗證，通過後由操作者安排正式切換。完整流程及環境變數操作延續 README_V2.9.md 的「完整還原程序」，schema 相容上限改為 30。程式／依賴／SMTP 憑證不含在快照中。

保留 `SMTP_*`、`PUBLIC_BASE_URL`、`BACKUP_INTERVAL_MINUTES`、`BACKUP_DIR`、`AUDIT_RETENTION_DAYS`、`COOKIE_SECURE`、`TRUST_PROXY` 等原設定。程式不自動讀 .env，請使用環境變數或 Node `--env-file`。SMTP accepted 不等於送達；不確定結果不自動重寄。備份不自動刪除，請管理磁碟與異地保存。

## 尚未完成與下一版

安全自助查詢碼找回、全部資格失效後的獨立身份驗證流程、最終送達／退信 Webhook、多節點共享限流、異地加密與防竄改備份仍未實作。真實 SMTP、HTTPS Tunnel／反向代理、實體手機與相機、完整無障礙、壓力及滲透測試需要另行驗收。

V3.1 建議先補安全查詢碼找回與實際部署驗收，再處理上述跨裝置／維運能力。自動測試結果、瀏覽器實際觀察及各代理工作見 TEST_RESULTS_V3.0.md、SECURITY_REVIEW_V3.0.md、QA_REVIEW_V3.0.md 與 V3_COLLABORATION.md；未驗證項目不得當作完成。
