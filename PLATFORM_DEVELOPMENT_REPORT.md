# EventFlow V3.0 會員與社群開發報告

日期：2026-11-25。版本 3.0.0，schema 31。本報告記錄本輪實作，取代只描述 schema 30 多組織資格的版本範圍；歷史紀錄保留於 CHANGELOG。

## 協作範圍與介面

| 角色 | 檔案責任與交付 | 協調界面 |
|---|---|---|
| 主代理／架構 | server.js 整合、既有帳號邀請橋接、公開導覽、通知事件、整體回歸及 Git | PLATFORM_CONTRACT.md；先確認各代理檔案責任，整合後提交 |
| A 前端／後台表單 | 活動精靈、表單設計器、Dashboard、後台導覽與樣式 | B 會員 DTO、C 聊天事件、D schema、既有 JSON keys |
| B 會員工程師 | 會員前端／個人中心、modules/member-platform.js、會員雙 audience Session、驗證與重設、個人報名／通知 | 同 users 身份；會員 cookie 不授予管理權；通知事件輸出 |
| C 即時社群／資安 | 社群前端、modules/chat.js、Socket.IO、公共／活動／DM、逐事件與逐接收者權限、檢舉管理 | verified member、member CSRF、platformEvents、房間游標 |
| D 資料庫 | modules/database.js schema 31、相容性／索引／快照擴充 | 可重複 Migration，保留原資料；快照涵蓋 DB、uploads、郵件金鑰 |
| E QA／審查 | 維護式測試、越權與舊資料回歸、最終測試證據 | 測試失敗回報對應檔案 owner；主代理整合後再跑完整測試 |
| F 文件 | README、API、ERD、系統藍圖、本報告與交接 | 僅描述實際程式；最終測試數由主代理填寫 |

本輪六位子代理依附件要求分工，A–F 全數完成回報，主代理負責專案管理與整合。沒有讓多代理未經協調修改同一檔案。

## 已實作

- 一般會員註冊、限時單次 Email 驗證、密碼自助重設、個人中心、頭像、常用資料、本人報名及正式憑證、舊報名安全認領。
- 同一 users 身份、兩種 Session audience；一般註冊 role=member，不自動加入組織。公開 profile 停用不鎖住原管理資格。明確、匹配且已驗證的會員可接受組織邀請，之後另行後台登入。
- 五步活動精靈、七個內建範本、組織範本、型別化欄位與驗證、獨立預覽和後端發布檢查。原有系統必填資料不能移除。
- Socket.IO 公共、活動與雙人文字聊天；持久歷史與游標補載、私訊申請、封鎖、公開暱稱查找、置頂、公告、禁言、檢舉。每次事件及傳送給每個接收者都重新驗權。
- 站內通知分類／已讀／偏好；真實報名、審核、遞補、活動取消、時間變更、即將開始、公告與私訊事件觸發，使用 event_key 去重。活動公告與提醒設定控制對應事件通知。
- 真實 Dashboard、分區導覽與手機折疊導覽；會員郵件安全投遞追蹤與 owner 重試介面。沒有 SMTP／公開網址時是 preview，不回秘密、不冒稱成功。
- 原報名與候補 FIFO、Email、QR／重複核銷防護、CSV／統計、組織 RBAC、稽核、備份與新目錄還原流程保留。

主要檔案：server.js、modules/member-platform.js、modules/chat.js、modules/forms.js、modules/platform-admin.js、modules/database.js、會員／社群／精靈前端及對應 CSS、維護式測試與本輪文件。完整檔案差異以主代理提交 diff 為準。

## 資料與遷移

schema 31 增量增加會員、通知、表單及聊天資料表；完整 29 個實際資料表、欄位、PK／FK／索引記於 ERD_V3.0.md。既有 schema 30 organization_memberships、registration_requests 與原欄位保留。新報名以 member_user_id 關聯，不能只憑相同 Email 認領舊報名。

正式來源仍為 schema 29，首次正式啟動新版時才遷移至 31。已建立並驗證完整備份 `data/pre-v31-backups/eventflow-1795614321803-3c20e4d7-12ef-4ae3-b51f-4f69778100d1`，程式備份 `data/source-before-v31-1795614322423`。2026-11-25T13:49:20.466Z 唯讀核對 integrity=ok、外鍵錯誤=0；organizations 2、users 1、events 6、registrations 1、tickets 1、checkins 0、notifications 1、audit 67，八表原始欄位與資料列雜湊全部保持。自動測試在正式資料一致性副本上完成29→31並逐欄保留；另測30→31、重啟冪等與暫存目錄還原。未對正式資料執行遷移或破壞性還原。

## 驗證證據與限制

| 證據 | 結果與性質 |
|---|---|
| B 會員獨立 smoke | 代理完成實際會員流程檢查；不是完整維護式測試的替代品，詳細由主代理保留 |
| C 兩個真實 Socket.IO client smoke | 實際會員服務／驗證 API、雙客戶端訊息與授權，沒有 stub Socket.IO；不是瀏覽器或負載驗收 |
| D DB 獨立 smoke | 代理完成 schema／相容性／快照相關檢查；正式來源遷移證據另列 |
| E 維護式自動測試 | 2026-11-25：新增16項平台情境全部通過，保留24項歷史測試 |
| npm run check | 53 個程式／HTML 檔案通過 |
| npm test | 40 項通過、0 失敗、0 略過；包含正式資料一致性副本 |
| 文件結構 | 依實際路由及 PRAGMA schema 產生 API／ERD，藍圖不放舊測試數；這不是功能驗收 |

功能狀態採四類：已實作、已自動測試、待人工驗收、尚未實作。只有 TEST_RESULTS_V3.0.md 最終列明的案例可標示已自動測試。自動測試通過不代表完整瀏覽器驗收；本輪沒有執行真實瀏覽器或實體裝置驗收。

待人工驗收：真實 SMTP 收信／投遞、HTTPS Tunnel／Coolify WebSocket、跨裝置／讀屏／完整手機介面、實體 QR 核銷、長時間排程、正式還原切換。登入、活動精靈、會員預填、私訊接受／封鎖、站內通知偏好亦需按實際瀏覽器逐條驗收。

部分完成：Email SMTP accepted 與送達不同，無退信 webhook；即時功能單程序；備份依服務運行且需外部安全儲存；私訊偏好 closed 阻擋新對話，已接受對話保留。已拒絕的 canonical 私訊目前沒有重新申請流程。

尚未實作：付款、語音／視訊、端對端加密、離線傳送、跨節點 adapter／共享限流、異地加密與不可變稽核、完整監控告警、自助查詢碼找回。不將基本 health API 冒稱監控平台。

## 安裝、分支與交付

開發工作區：C:/Users/User/Documents/ChatGPT/KUHUB/eventflow-platform-work。正式本機目標 D:/Coding/EventFlow 的安裝結果：已直接安裝全部程式、文件及相符依賴；正式資料保持原狀。

開發分支 codex/eventflow-v3.0；本輪起點 919443a。查閱 main d27663b 的 Docker／Coolify 配置並保留，不合併 main。階段一 `b748780`（會員／API／schema），階段二 `f03f097`（前端／維護式測試），均在檢查通過後提交。階段三為本文件與最終證據提交，精確 SHA 及遠端推送核對由交付訊息及 git log 記錄，避免文件自我引用自己的 Commit。推送目標 origin/codex/eventflow-v3.0，不合併 main。臨時 .chat-smoke metadata 不屬正式交付。

本機驗收：npm ci → npm run check → npm test → npm start；依啟動輸出的 Port 開啟首頁、member.html、community.html 與 admin.html。保留真實 data/uploads/backups 與郵件金鑰，不能以覆蓋資料方式安裝。

## 後續方向

優先完成真實裝置／SMTP／公開部署驗收與正式還原演練，再評估共享限流、跨節點即時架構、通知投遞回執、隱私與留存操作、多裝置 Session 管理。先補營運可靠性與既有 UX 驗收，不將未實作功能列為 V3.0 已交付。
