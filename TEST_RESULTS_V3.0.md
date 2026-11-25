# EventFlow V3.0 實際測試與交付檢查

日期：2026-11-25。基底 `5d4458a`，新版本 3.0.0／schema 30。測試使用暫存 SQLite、隔離 uploads、停用 SMTP；不以正式資料做報名、核銷或破壞性還原。

## 實際結果

- 隔離整合副本：`npm run check` 通過（35 檔）；`npm test` 共 24 項，23 通過、0 失敗、1 略過。略過項為正式資料唯讀副本測試，隔離程式副本沒有正式資料庫；其他合成歷史資料遷移照常測試。
- 正式專案 `D:\Coding\EventFlow` 安裝後：`npm run check` 通過（35 檔）；`npm test` **24 項通過、0 失敗、0 略過**，包含正式 SQLite 的唯讀一致性副本升級及逐欄保留檢查。
- 瀏覽器基本操作（前端代理實際執行）：Chrome 隔離網站的合成成員登入成功，畫面顯示預設主辦單位、組織管理員 admin 與 Dashboard 1 場活動。原生瀏覽器操作中斷後停止輸入，未完成組織切換、邀請、登出清理及公開報名的真實 UI 驗證；無可交付 V3.0 截圖，這些操作仍待人工驗收。相關自動 handler／API 測試不能冒充完整瀏覽器實測。
- 本版之前的原始基準測試在隔離副本有一項失敗：V2.5 測試直接開 root/data，無法在乾淨副本重現。QA 改為 genuine 合成 V2.4 資料，不略過此主測試；回歸後通過。

## 新增 9 項 V3.0 情境測試

1. 同一帳號在 A 為 admin、B 為 staff；切換後角色、活動、報名、CSV／報表遵守有效資格；外部組織、null scope、資格暫停不能越權。
2. 變更某組織資格／活動權限不破壞其他組織授權及 Session；全平台停用／密碼修改只允許 owner 全域，並撤銷所有 Session。
3. 既有帳號接受新組織邀請需要匹配身份及 CSRF；保留原密碼／home／其他 grants；單次、撤銷及 issuer 資格降級均拒絕不合法接受。
4. 報名冪等識別碼的並行建立、滿額／關閉後原結果恢復、異動內容／跨活動／逾期衝突；不另建立報名、不重複名額或通知。
5. Genuine schema 29 fixture 升級 30；原活動、報名、帳號、QR、簽到、授權與 Session 保留；遷移前備份，重複啟動只套用一次。
6. schema 30 完整快照、會員與報名映射驗證、新目錄還原、Session／帳號連結撤銷、待送郵件暫停；原快照不被覆蓋。
7. 執行實際邀請送出 handler，模擬 disabled 表單控制項，驗證 admin 仍明確送出組織與 staff 角色，不依靠會漏欄位的 FormData。
8. 執行實際報名 handler，驗證 participants.max 降為 0 時同一已送 payload 仍可恢復；內容改變後仍須正常驗證，不能用重試旁路任意表單規則。

9. 延遲私人 API 回應在登出／切組織後被 generation 拒收，不能把上一身份資料重新交給畫面。

舊 V2.5～V2.9 測試保留 QR 真實解碼、原子及重複核銷、候補 FIFO、審核、Email／重試、Session／CSRF／Cookie／速率、逐活動 RBAC、CSV 與資料隔離。歷史測試中的 schema 27／28／29 fixture 先移除新版表、Trigger 及版本記錄，再按真正舊版資料結構重建，沒有只改標籤假裝遷移。

## 獨立代理審查

資料庫代理用暫存資料驗證新建／29→30、home／grant 保存、Session 補值、跨組織 grant 拒絕、錯誤活動映射拒絕、快照與重啟。後端代理檢查 membership、匹配邀請、重送恢復與全平台停用。資安代理獨立 HTTP 檢查 stale role、跨組織 CSV／資源、CSRF、owner scope、資格及全平台停用。詳見 SECURITY_REVIEW_V3.0.md 與 QA_REVIEW_V3.0.md。

代理獨立 smoke 與 24 項主測試是不同驗證層次，不把 smoke 次數混算成 npm test 的測試數，也不宣稱取代真實使用者驗收。

## 正式資料保護

安裝前已以正式 SQLite 的唯讀連線建立完整快照，驗證成功後保存 DB、uploads 與帳號郵件金鑰；原始碼另存 source-before-v30。正式來源 schema 為 29。程式安裝不執行正式 migration；測試中的「正式資料」只在一致性副本上升級及逐欄比對。

最終唯讀比對（2026-11-25T11:56:18.696Z）：正式來源仍為 schema 29，integrity_check=ok，foreign_key_check=0。升級前 organizations、users、events、registrations、tickets、checkins、notifications、audit 原欄位與資料列雜湊全部保留。正式 migration30 留待使用者以正式資料首次啟動新版。

完整快照：`data/pre-v30-backups/eventflow-1795607417294-ab6ac290-94b8-4971-bb72-5020ae161664`；程式備份：`data/source-before-v30-1795607417582`。備份與金鑰不加入 Git。

## 待人工驗收與限制

- 真實 SMTP／TLS／收件匣、HTTPS Tunnel／反向代理、安全 Cookie 與實體手機相機。
- 完整手機／平板／桌面、鍵盤／讀屏、慢速網路、長時間排程、正式還原切換、負載及滲透測試。
- 報名 key／草稿只在原分頁記憶體；關閉分頁或跨裝置遺失查詢碼的安全找回尚未實作。
- 所有會員資格暫停的既有帳號不能登入接受新組織邀請，目前需先由管理員恢復資格。
- SMTP accepted 不等於 delivered；最終送達／退信 Webhook、共享限流、異地加密與不可變稽核未實作。

完整啟動、遷移與新目錄還原步驟見 README_V3.0.md。只有實際執行且通過的項目才標為已驗證。

## 整合發現與修正

QA 指出舊 staffMode 省略預設與新 membership 實作的相容差異，主代理保留舊 API organization 預設。主代理指出重試表單原生驗證與全域 owner UI 未變更 globalDisabled:false 會誤撤其他組織 Session；前端及主代理分別修正，QA 增補後，最終完整 24 項通過。平台停用／恢復及密碼變更另有明確稽核動作，只存目標 ID。
