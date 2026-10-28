# EventFlow V2.7

直接在 D:\Coding\EventFlow 執行 npm start。前台 http://localhost:3000，後台 /admin.html，藍圖 /blueprint.html。需 Node.js >=24.0（本次驗證為 24.14.0；遷移使用新版 SQLite backup API）。先停止原 V2.6 程序，再啟動新版並重新整理瀏覽器。未製作 ZIP。

## 已實作
- 組織目錄、建立與編輯；owner 工作範圍切換（儲存於目前登入 session，各登入獨立）。所有組織範圍為跨組織營運總覽；品牌設定及 Demo 建立以目前 organization_id 為準，建議先選定組織再操作。
- 帳號建立、admin/staff 角色變更、組織轉移、停用與密碼重設（owner）。變更帳號會刪除其全部 sessions，停用禁止登入。owner 不可在此降權或停用。
- admin 僅管理自己的活動、品牌、組織；可查看自己組織成員與稽核。staff 延續 V2.6：查看自己的活動／報名／報表／通知、審核與 QR 簽到，無組織編輯、活動建立、品牌編輯、帳號管理、稽核及完整備份權限。owner 跨組織權限是明確的平台管理能力。
- 活動、報名、審核、QR、簽到、CSV、報表、通知後端授權。公開活動屬可探索內容；草稿、取消與封存活動不提供公開詳情。公開報名不提供管理個資查詢。
- 稽核含時間、操作者 Email 快照、動作與組織。管理異動、匯出、成功登入登出、拒絕存取、通知重試會記錄。舊 audit 不推測歸屬，僅 owner 全域可查；每次最多最近 200 筆。尚無外部防竄改儲存。
- 重新設計圖文分割 Hero、編輯式活動卡片、價格與主辦單位、雙欄活動詳情與報名、查詢區；統一 SaaS 側欄、工作範圍、儀表板 SVG 趨勢與狀態圖、組織／成員／稽核／通知分區、響應式佈局。
- 保留 V2.6 三類 CSV／報表、V2.5 EF25 QR、Email 佇列、候補與自訂表單。候補仍不自動遞補。

## SQLite 安全遷移
首次啟動 V2.7，在任何 schema 更新前透過 node:sqlite backup API 建立一致性備份（包含 WAL 已提交資料），放在目前 EVENTFLOW_DATA_DIR 或 data 下的 migration-backups/pre-v27-時間戳.sqlite。備份失敗即停止啟動。
新欄位與索引在 BEGIN IMMEDIATE 交易加入，foreign_key_check 通過才提交，user_version=27，schema_migrations 記錄版本。既有 ID、角色、密碼雜湊、活動／報名、QR、簽到、通知與品牌不改寫。再啟動不重做遷移備份。
程式快照位於 upgrade-backups/v26-before-v27-*（不是完整運行中資料備份）。未在正式資料執行試寫；正式 SQLite 將於你首次啟動新版時遷移。

## 回復舊版
先停止所有 EventFlow 程序。保留目前 data 與 public/uploads 的完整副本；在全新的復原目錄搭配 V2.6 程式快照與 pre-v27 SQLite 備份，指向 EVENTFLOW_DATA_DIR 後啟動，避免混用舊 WAL/SHM。回復到備份時間點將不包含之後的新報名。不要直接覆蓋運行中的資料庫。JSON 匯出僅作資料取用，尚無完整 V2.7 一鍵還原。

## 圖片
見 public/image-credits.html。免費 Unsplash License 已查核；陶藝、京都、星空依標題配對，其他依分類提供主題示意，非活動實景。主辦上傳優先，本機 SVG 備援。網路圖片需連線。圖片授權 https://unsplash.com/license 。

## V2.8–V3.0
V2.8：邀請／密碼自助重設、多組織成員、細分權限、候補遞補。
V2.9：通知投遞追蹤、稽核查詢留存、排程備份與完整還原演練。
V3.0：正式部署、負載／弱點驗證、監控告警；自助開通與計費另案。
以上為規劃，未宣稱已完成。驗證結果請見 TEST_RESULTS_V2.7.md。
