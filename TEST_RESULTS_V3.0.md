# EventFlow V3.0 會員與社群實際測試結果

日期：2026-11-25（Asia/Taipei）。版本3.0.0，目標schema31。本報告取代上一輪schema30的24項測試報告；舊協作報告保留為歷史資料。

## 執行結果

| 場所／指令 | 實際結果 |
|---|---|
| 隔離整合副本 npm run check | 53個程式／HTML檔案通過 |
| 隔離整合副本 npm test | 40項，39通過、0失敗、1略過；該副本沒有正式資料庫 |
| D:/Coding/EventFlow npm run check | 53個檔案通過 |
| D:/Coding/EventFlow npm test | **40通過、0失敗、0略過**，含正式資料一致性副本升級 |
| npm audit --omit=dev --audit-level=high | 0 vulnerabilities |
| 第一階段暫存索引快照 | check42檔；24項23通過、0失敗、1略過（無正式庫）；提交前獨立驗證 |

SMTP停用，API使用獨立暫存SQLite／uploads與隨機本機連接埠。正式資料只讀取建立一致性副本，不在來源執行報名／核銷／遷移或破壞性還原。先前受限程序啟動曾產生spawn EPERM；允許執行子程序後完整重跑通過，沒有刪除失敗測試。

## 新增16項維護式平台測試

1. 註冊／驗證、雙audience與CSRF隔離、安全頭像、軟停用請求。
2. 密碼重設單次／不洩漏帳號／速率限制／兩種Session撤銷。
3. 已驗證會員報名、訪客條件、個人歷史與QR隔離、Email加秘密認領。
4. 組織模板隔離、進階欄位、發布條件、不可改寫歷史快照。
5. 真實報名／活動異動通知、收件人／偏好、rollback不推送幽靈通知。
6. 真實即將開始活動的提醒與去重。
7. 真正schema30→31、原資料保存、頭像／聊天完整快照、新目錄還原及重跑。
8. 兩個獨立已登入Socket.IO客戶端真實通訊、持久歷史、重連游標、私訊請求、封鎖／禁言／檢舉／登出。
9. 活動取消與staff grant變更後即時重新驗權。
10. owner建立公開profile仍受audience隔離，公開停用不破壞管理身份。
11. 個別使用者推播、presence隱私、分頁與訊息限流。
12. 已驗證會員接受明確staff邀請；不自動授權，另行後台登入。
13. 實際精靈處理函式先存草稿再發布；預覽不建立報名（VM行為測試）。
14. 公告設定與不可移除系統必填欄位由後端強制執行。
15. 共用密碼異動後跨audience舊重設連結失效。
16. owner限定會員投遞診斷、秘密遮蔽、沒有SMTP拒絕假重試。

24項歷史測試保留真實QR解碼與原子核銷、重複報名恢復、FIFO候補、審核、SMTP佇列狀態、邀請／重設、CSV／報表、逐活動與跨組織RBAC、Cookie／CSRF／登入限流、稽核、舊資料遷移、備份與新目錄還原。完整案例名稱見test/*.test.js，不以smoke次數增加測試總數。

## 正式來源與備份

正式來源仍schema29，首次npm start才執行增量migration到31。2026-11-25T13:49:20.466Z核對integrity_check=ok、foreign_key_check=0。八表原欄位與資料列雜湊全部一致：organizations2、users1、events6、registrations1、tickets1、checkins0、notifications1、audit67。

完整備份：`data/pre-v31-backups/eventflow-1795614321803-3c20e4d7-12ef-4ae3-b51f-4f69778100d1`；程式備份：`data/source-before-v31-1795614322423`。備份含uploads及郵件金鑰，未加入Git。合成舊schema fixture先實際移除新版結構再重建，不靠改版本標籤冒充舊資料。

## 安全修正與驗收邊界

修正共用密碼的重設Token跨audience撤銷、邀請role讀取、公告偏好及系統必填驗證。依賴body-parser更新至1.20.9，修補[GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)。Socket.IO以逐事件及逐接收者授權補足[連線middleware只於建連線執行](https://socket.io/docs/v4/middlewares/)的限制；歷史同步依資料庫游標，不依賴連線恢復一定成功。

本輪沒有執行真實瀏覽器、手機／平板／讀屏、真SMTP收件、HTTPS Tunnel／Coolify WebSocket、正式還原切換、長時間排程或負載／外部滲透驗收。前端語法、識別碼與部分實際handler測試通過，不代表上述人工項目通過。會員刪除是軟請求；私訊closed只阻擋新對話，拒絕後尚無重新申請；偏好僅控制站內通知。SMTP accepted不等於送達，多程序共享限流、跨節點adapter、付款、語音視訊、E2EE及完整監控尚未實作。

完整操作與限制見README_V3.0.md；API見API_V3.0.md，29表結構見ERD_V3.0.md，多代理交付見PLATFORM_DEVELOPMENT_REPORT.md。
