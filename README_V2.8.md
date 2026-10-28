# EventFlow V2.8 操作與維護

更新日期：2026-10-21。Node.js >=24.0（本次測試 24.14.0）、Express、SQLite、原生 HTML/CSS/JavaScript。專案沒有 Git 儲存庫，未建立 Git commit；原始碼快照保存在 `upgrade-backups/v27-before-v28-*`。本次直接修改既有 Work 專案，沒有打包 ZIP。

## 啟動

先在原本的終端機停止舊版服務，再執行：

```powershell
cd D:\Coding\EventFlow
npm install
npm run check
npm test
npm start
```

前台 `http://localhost:3000`、後台 `/admin.html`、藍圖 `/blueprint.html`。需要其他埠可先設定 `$env:PORT='3001'`。首次空資料庫透過後台建立 owner，現有帳號不需重建。首次 V2.8 遷移會撤銷既有 Session，須重新登入；密碼雜湊及活動資料保留。

## 角色與活動授權

| 角色 | 範圍與權限 |
|---|---|
| 訪客 | 瀏覽公開活動、報名，以私有查詢碼查詢及取得 QR |
| owner 系統管理員 | 平台管理；可切換所有組織或特定組織。選定組織後，資源讀寫、匯出均受該範圍限制；完整備份及匯入須切回「所有組織」 |
| admin 組織管理員 | 管理自己的活動、品牌、組織；建立、停用及編輯本組織 staff、設定活動權限；查看本組織成員、通知及稽核。不能建立或修改 admin/owner，不能跨組織或提升角色 |
| staff 工作人員 | 「組織全部活動」延續原有查看、審核、簽到與匯出權限；「僅指定活動」需先勾選活動，才可查看該活動的報名／簽到／報表／通知，審核、核銷、CSV 可分別授權 |

既有 staff 預設保留 organization 模式，避免無預警取消工作權限。新建帳號介面預設建議 assigned 模式，未勾選活動即無活動存取權。REST 舊客戶端未傳 staffMode 時保留 organization 預設以相容舊版；管理者應明確設定範圍。所有帳號異動立即撤銷該帳號的全部 Session，下一次登入採新權限。

公開活動本來就是可探索內容，不以後台組織登入限制；非公開草稿、取消與封存活動不提供公開詳情。管理用報名 API 不再回傳參加者 lookup_code，完整資料匯出仍只供 owner 全域使用。

## 主要流程

- 建立／編輯活動：完整表單、自訂欄位、發布、關閉、取消、封存。`DELETE /api/admin/events/:id` 採可還原封存，保留報名、QR、簽到與稽核；在活動編輯取消封存即可恢復。
- 報名審核：單筆或批次待審核，確認、拒絕與取消以交易連同通知佇列及稽核提交。候補可由有審核權限者手動確認遞補，後端重新檢查容量與活動狀態；尚無自動遞補。
- QR：維持 EF25 協定、每筆整組核銷一次。即使自行修改活動 ID 或憑證，仍須通過組織、活動與 canCheckin 授權。
- CSV 與報表：讀取報表使用可讀活動集合；匯出使用 canExport 活動集合。指定無匯出權限的活動會拒絕，不指定活動時只匯出有權限的活動。日期仍以 Asia/Taipei 的報名日期篩選。CSV 保留 BOM、引號換行與公式注入防護。
- Email：保留佇列、預覽、重試、五次失敗終止。SMTP 未設定時進入 preview，不寄出真實郵件。Nodemailer 更新至 10.1.7；錯誤紀錄只存有限錯誤代碼，避免記錄 SMTP 原文中的憑證。

## Session、CSRF 與 API

Session 使用隨機 Cookie、資料庫只存 SHA-256 雜湊，8 小時有效，HttpOnly、SameSite=Strict。保護 API 的 POST/PUT/PATCH/DELETE 均要求 `X-CSRF-Token`，值由登入後 `GET /api/me` 的 csrfToken 取得，綁定目前 Session。前端含二進位圖片上傳均已送出此標頭。舊 REST 客戶端需同步更新；唯讀 API 不需要此標頭。

所有非安全方法驗證 Origin／Fetch Metadata；JSON API 拒絕表單編碼。登入同一來源 IP 每分鐘 30 次、同帳號每 10 分鐘 10 次，429 附 Retry-After；公開報名／憑證等既有 throttle 每 IP 每分鐘 90 次。限制保存在單一程序記憶體，重新啟動會重置，多副本部署需共用儲存（尚未實作）。

錯誤格式統一為 `{error, code, requestId}`，另附 X-Request-Id 回應標頭。一般 API 不回傳 SQLite、檔案路徑或堆疊。活動欄位型別、字串長度、實際日期、欄位 ID、選項、自訂答案、成員及授權均有後端驗證。資料使用參數化 SQL，畫面以 textContent 或 HTML escaping 顯示使用者內容。

## HTTPS Tunnel

本機 HTTP 測試不需 Secure Cookie。公開 HTTPS 部署先在服務終端設定：

```powershell
$env:COOKIE_SECURE='1'
```

若代理透過本機 loopback 連線，且需要 Express 判定 HTTPS／客戶端 IP，可設定 `$env:TRUST_PROXY='loopback'`；僅信任 loopback，不開放任意代理。HOST 預設仍為 0.0.0.0，可用 `$env:HOST='127.0.0.1'` 限制本機。Tunnel 與服務需持續執行；實際 Tunnel、TLS 與相機須由使用者驗收。

## SQLite Migration 28

正式資料庫本次只以唯讀連線檢查，或透過 SQLite backup 取得測試副本；未在正式資料庫執行 V2.8 遷移或試寫。正式遷移發生於你首次啟動新版時。

1. 在任何 schema 更新之前，建立 `data/migration-backups/pre-v28-時間戳-UUID.sqlite` 一致性備份，包含已提交 WAL 資料。自訂 EVENTFLOW_DATA_DIR 則使用該目錄。
2. 僅對備份檔切換 DELETE journal，驗證 integrity_check，產生可攜單一 SQLite 檔。失敗即停止升級。
3. 增量、交易式加入 users.staff_mode、user_event_access、稽核結果欄位、索引與同組織授權 trigger，記錄 schema_migrations=28、user_version=28。
4. 檢查外鍵與完整性後提交；失敗回滾。重啟不重做已記錄的遷移。舊版資料庫會先執行相容的歷史增量遷移。
5. 活動、報名、簽到、QR token、通知、既有使用者欄位不改寫；舊 audit 結果標記 unknown，不捏造歷史結果。既有 Session 清除，要求重新登入。

完整還原仍須包含 data 與 public/uploads。回復前先停止所有服務，保留目前資料副本，再用原始碼快照與遷移前 SQLite 在新的復原目錄啟動，避免混用 WAL/SHM。回復到舊備份將不包含備份之後的新報名。JSON 備份不是完整一鍵復原工具，尚無 V2.8 完整自動還原。

## 稽核

稽核保留 at、user_id、actor_email、organization_id、action、detail、result、target_type、target_id、request_id、status_code。涵蓋成功／失敗登入、速率限制、拒絕操作、活動建立／修改／封存、審核／取消、核銷／重複核銷、成員與權限變更、資料匯出等。匿名失敗顯示未識別操作者，不儲存提交的密碼或 Token。後台可搜尋最近 200 筆並依結果篩選；尚無完整歷史分頁、外部防竄改或稽核留存清理。

## 模組

`modules/database.js` 遷移；`policy.js` 單一權限規則；`security.js` Session/CSRF/速率限制/錯誤；`validation.js` 輸入規格；`audit.js` 結果稽核；`members.js` 成員與活動授權；`events.js` 可復原刪除；`registrations.js` 審核交易；`mail.js` Email 佇列。server.js 保留既有其餘路由與整合，後續可再拆分。

## 驗收與後續

測試與人工驗收範圍見 TEST_RESULTS_V2.8.md。圖片沿用現有授權與本機 SVG 備援，詳見 `/image-credits.html`。

V2.9 優先：邀請與密碼自助重設、多組織成員資格、候補自動遞補、稽核分頁與通知追蹤、排程備份及完整還原演練。V3.0：正式部署、負載與弱點驗證、監控告警、共享 Session／速率限制；自助開通與計費另案。
