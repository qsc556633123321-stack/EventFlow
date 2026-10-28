# EventFlow V2.9 操作與維運

## 本版狀態

2026-10-28，從 GitHub main ff7f8e7（V2.8 baseline）建立開發分支 codex/eventflow-v2.9。功能與驗證依 TEST_RESULTS_V2.9.md；正式機、真實 SMTP 與實體手機仍待人工驗收。

## 公開報名與管理

- 首頁整張活動卡片可點擊、鍵盤 Enter 開啟，顯示價格、剩餘名額與報名狀態。搜尋包含名稱、地點與介紹；保留分類，新增價格排序、載入失敗重試及清除篩選。
- 活動分享網址 /event.html?id=活動ID；舊 /?event=活動ID 相容導向。詳情與表單分開，手機有底部報名入口。保留品牌、圖片上傳與本機示意圖備援，圖片來源見 /image-credits.html。
- 確認活動 → 填寫資料 → 確認送出 → 獨立結果頁。自訂欄位與既有 JSON Key 保留，必填、Email、手機即時提示；送出期間鎖定按鈕，API 失敗回到原資料。此保留限目前分頁，重新整理不保證保留未送出內容。
- 結果頁顯示報名編號、查詢碼、活動、人數、狀態，支援複製、重新查詢。pending 與 waitlisted 明確標為尚無正式憑證；QR 是否核發由後端決定。憑證資訊保存在本分頁 sessionStorage，分享活動網址不包含私人查詢碼。瀏覽器禁用儲存時以 fragment 暫存結果憑證，請勿分享該結果連結。
- 後台保留發布、編輯、可還原封存、自訂欄位、審核、CSV、報表、QR 核銷、組織及逐活動 RBAC。候補自動遞補可在活動表單切換為手動。

## 成員邀請與密碼重設

「成員與權限」建立 48 小時一次性邀請。邀請連結僅於建立時顯示，未設定 SMTP 時須自行安全傳送；不可公開張貼。admin 只能邀請所屬組織 staff，owner 也受已選定的組織範圍限制。接受時再次檢查邀請者目前權限，避免已停用或失權邀請者留下可用連結。新 staff 預設 assigned 且無活動授權；接受後請管理員設定活動及審核／簽到／CSV 權限。

登入頁「忘記密碼」提供 Email 自助重設，連結 30 分鐘且單次有效。回應不透露帳號存在與否；每 IP 20 次／15 分鐘、每 Email 5 次／15 分鐘，另有通用速率限制。更新密碼立即撤銷所有登入。Token 在資料庫只保存雜湊，帳號郵件內容採 AES-256-GCM 加密，金鑰 data/account-mail.key 必須與資料庫一起保護、備份。請勿刪除金鑰，否則尚未寄出的帳號郵件無法解密。

同 Email 既有帳號不能再次邀請；本版每帳號仍僅一個組織，多組織成員資格是 V3.0 設計項目，沒有冒充已完成。

## 候補交易規則

已確認取消、待審核拒絕／取消、批次審核釋出名額，或調整活動容量／啟用規則時，在同一 BEGIN IMMEDIATE 交易檢查候補、更新狀態、寫入通知佇列及稽核。按 created_at、rowid 先後遞補；一筆多人報名不能拆組，隊首人數不合時停止，不讓較小後報組超車。待審核也占用名額；需要審核的活動遞補後為 pending，不能立即取得 QR。已暫停、取消或封存活動不自動遞補。可手動確認候補，後端仍檢查容量與權限。

交易成功與 SMTP 成功分離。郵件寄送失敗不撤銷已遞補名額。單一 Node 服務為支援部署方式；排程不是離線作業，服務停止時不執行，下一次啟動後在排程輪詢時補做。

## 郵件設定與狀態

保留 SMTP_HOST、SMTP_PORT（預設 587）、SMTP_SECURE=1、SMTP_USER、SMTP_PASS、SMTP_FROM。帳號邀請／重設另需設定 PUBLIC_BASE_URL 為使用者實際可存取的公開 origin，例如 https://你的公開網域；不要用使用者無法連線的 localhost。

原程式不會自動讀取 .env，請用 PowerShell 環境變數或 Node 原生 --env-file：

```powershell
$env:PUBLIC_BASE_URL='https://你的公開網域'
$env:SMTP_HOST='你的SMTP主機'
$env:SMTP_FROM='你的寄件地址'
npm start
```

後台通知頁同時列出報名及帳號通知。queued／retry 等待處理；preview 明確未寄送；sent／accepted 只表示 SMTP 接受，不代表收件匣送達。已知尚未接受的失敗採退避重試，最多 5 次，可在後台重試。佇列原子領取及固定 messageId 避免並行重複寄送；逾時／DATA 後斷線等結果不確定則 uncertain，不自動或透過一般重試鍵重寄。請先查 SMTP 紀錄人工處理，無法保證外部 SMTP exactly-once。

無 SMTP 或帳號公開網址時不聲稱已寄送。已使用、撤銷或逾期帳號通知不再寄出。沒有收件回條或退信 Webhook，本版不追蹤最終 delivered／bounced。

## SQLite 遷移與資料相容

Migration 29 可重複啟動且只套用一次，交易前先建立 migration-backups 下的一致性 SQLite 備份並驗證。新增 events.auto_waitlist；notifications 的 message_id、delivery_state、lease_until；account_tokens、account_messages、maintenance_state 與查詢索引。沒有改名舊欄位或刪除既有活動／報名／帳號／QR／簽到資料。公開活動資料新增描述、主辦單位、容量與 canonical allowWaitlist；仍保留 allow_waitlist，舊 API 路徑及回應欄位相容。

從 V2.8 升級保留 Session；從更早版本沿用歷史 migration 的 Session 撤銷策略。migration 版本高於 29 則拒絕啟動。遷移錯誤回滾，不可清空資料重試。開發測試使用隔離資料；最終唯讀檢查發現本機另有正式服務已於 2026-10-28 20:55 啟動，正式庫已自動遷移到 29，完整性與外鍵正常，原資料保留。未停止或回退正在運作的正式服務。其他部署仍於首次啟動遷移。

## 完整備份

系統管理員在「所有組織」範圍可使用後台完整快照與驗證，也可用命令：

```powershell
npm run maintenance -- backup
npm run maintenance -- verify --backup 'D:\Coding\EventFlow\data\backups\完整備份資料夾名稱'
```

每份快照為資料夾，包含 database.sqlite、uploads、account-mail.key（已建立時）、manifest.json 的 SHA-256 與大小。檢查 SQLite integrity／外鍵、schema、檔案清單、圖片引用及金鑰存在，完成才原子更名。拒絕路徑穿越與 symlink。舊版 JSON 相容匯入／匯出仍保留，但不能代替完整快照。

設定 BACKUP_INTERVAL_MINUTES（預設 1440，0 停用）、BACKUP_DIR（預設 data/backups）、AUDIT_RETENTION_DAYS（預設 0 永久保留；啟用須至少 30 日）。每 60 秒檢查到期排程；狀態跨重啟保留。留存清理先建立含舊稽核的完整快照，成功後才移除線上舊紀錄。失敗不清理。備份不自動刪除，請定期移至受保護的異地儲存並監控磁碟空間。不要將備份目錄配置在 public 可公開下載路徑。完整快照含個資與加密金鑰，SHA-256 只能檢查一致性，不等於具防竄改簽章或加密備份。

若程序異常中斷留下 .create.lock，先停止所有備份／服務，確認沒有工作中程序，再移除該鎖並重試；不可在備份進行時強制解鎖。

## 完整還原程序（新目錄）

1. 停止所有 EventFlow 程序，保留目前專案及資料，另外建立目前完整備份。記錄目前版本及快照路徑，不要覆蓋正式資料。
2. 先執行 verify。必須使用相容版本原始碼、Node 24+ 及依賴；備份不含程式、node_modules 或 SMTP 密碼。
3. 以 maintenance 還原至**不存在**、位於專案與資料目錄外且父目錄已存在的新位置：

```powershell
npm run maintenance -- restore --backup 'D:\Coding\EventFlow\data\backups\完整備份資料夾名稱' --target 'D:\Coding\EventFlow-restored-20261028'
```

4. 工具驗證後還原 data 與 public/uploads，撤銷 Session 與未使用帳號連結，暫停待送郵件為 uncertain 避免復原後重寄。QR／簽到／報名歷史保留。RESTORE.json 記錄此復原，原快照與正式來源不變。
5. 使用相同版本原始碼，暫時改用新目錄做隔離驗證：

```powershell
$env:EVENTFLOW_DATA_DIR='D:\Coding\EventFlow-restored-20261028\data'
$env:EVENTFLOW_UPLOADS_DIR='D:\Coding\EventFlow-restored-20261028\public\uploads'
$env:PORT='3001'
$env:BACKUP_INTERVAL_MINUTES='0'
$env:SMTP_HOST=''
npm start
```

6. 用 3001 檢查登入、資料筆數、圖片、報名及歷史簽到；這是新副本，不是正式切換。通過後停止測試服務，由操作者維護時段切換啟動環境到已驗證的新資料／圖片目錄，恢復公開網址、SMTP 與備份設定，再啟動唯一一個正式程序。切勿同時啟動兩個服務自動寄信。
7. 若要退出還原驗證，停止服務並移除上述測試環境變數，回到原啟動設定。沒有把已遷移 schema 降版的自動功能；回到舊程式須配對相容的舊版快照。

本次只在暫存資料做還原演練，未對正式資料做破壞性還原。

## 稽核、權限與限制

新增 /api/admin/audit/page，支援 page、pageSize（1–100）、search、result、from、to（台北日期含迄日）；舊 /api/admin/audit 仍回傳陣列。後端套用組織隔離，staff 無權讀取管理稽核／邀請／完整快照。邀請、接受、重設、遞補、帳號通知重試及備份產生稽核，不寫入明文 Token 或密碼。

登入及重設速率限制為單程序記憶體，重啟重置。備份與帳號金鑰不是外部加密金鑰管理或異地災難復原。真實 SMTP、HTTPS Tunnel、相機與跨裝置無障礙尚待驗收。未實作付款、計費、自助租戶開通或多組織會員切換。

## V3.0 設計方向（尚未實作）

新增 organization_memberships(user_id,organization_id,role,status)，以複合唯一鍵維護 membership；Session 綁定 active membership，逐活動授權同時綁定組織，所有 API 改由 active membership 推導授權，邀請已存在 Email 需登入後接受且不可隱性搬移舊組織。遷移先為每個既有帳號建立唯一 membership，再保留相容欄位及回歸測試，驗證後才討論淘汰。

其餘建議：真實部署驗收、收件回執／退信處理、共享速率限制與寄信工作程序、異地加密備份／簽章、監控告警與負載測試。規劃功能不標示完成。
