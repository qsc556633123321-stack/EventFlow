# EventFlow V3.0 多代理協作與完整開發報告

日期：2026-11-25。主代理擔任專案經理／架構師，五個子代理依使用者指定職責協作。基底為已合併 V2.9 的 `5d4458a`；版本升為 3.0.0，資料庫 schema 30。主線是將既有藍圖的多組織會員設計落實，並修復已盤點的優先 UX 中斷。

## 架構分析與工作契約

既有架構為 Express server、共用 policy／security、SQLite 增量 migration、靜態 HTML／CSS／JS、通知佇列及離線維護工具。V2.9 的身份與授權仍直接依 users.home organization／role，不能安全承載一人多組織；因此採 additive memberships，保留舊帳號欄位與 API keys，Session 使用既有 organization_id 指向目前資格。

開工前先建立 V3_CONTRACT.json，記錄資料表、Session／API、邀請、報名冪等規格及每個檔案責任。可獨立工作平行處理，依執行槽位與相依關係安排前端／後端／資料庫先行，資安及 QA 接續。五個子代理皆有實際產出；主代理等待完成、整合與執行最終測試，不將派工本身當作交付。

| 代理 | 唯一寫入責任 | 實際產出與驗證 |
| --- | --- | --- |
| 前端工程師 | public/admin.html、governance.js、upgrade29.js、discovery.js、account.js、event/result/index/account.html、ticket.js、v30.css | 多組織選單、有效角色、既有帳號邀請、明確 admin payload、私人資料清理、重試 key、來源上下文、待授權引導與 V3 UI；語法檢查與瀏覽器結果依最終紀錄 |
| 後端工程師 | modules/members.js、accounts.js、registrations.js | 資格與全平台狀態分開、同 Email 新組織邀請、匹配 Session／CSRF、交易式冪等報名；隔離 API smoke |
| 資料庫工程師 | modules/database.js、maintenance.js、scripts/maintenance.mjs | migration30、回填、索引／Trigger、舊快照相容、會員快照與關聯驗證；獨立暫存升級／還原 smoke |
| 資安工程師 | modules/security.js、policy.js；validation.js 僅檢查未需修改 | 每請求有效資格、owner 唯一平台權限、拒絕 stale role／跨組織／CSRF；獨立 HTTP 檢查與安全報告 |
| QA 測試工程師 | test/*.js、QA_REVIEW_V3.0.md | 修乾淨副本歷史 fixture、9 項 V3 新情境、舊版回歸與程式碼審查；發現相容及前端限制後回報責任者 |
| 主代理 | server.js、package／lock、主文件、blueprint、接線、備份與 Git | 初始 owner 資格、scope／me API、活動聚合查詢、版本整合、完整備份、最終檢查與 Commit |

跨檔修改先協調。後端完成後，QA 發現舊 POST /api/users 未帶 staffMode 預設語意需保留；主代理通知原責任者及 QA 後，接管 members.js 的相容 fallback 修正；另協調修正未變更 globalDisabled:false 的 Session 撤銷範圍及補明確帳號稽核。前端重送原生表單驗證缺口由主代理發現、前端修正、QA 加測。沒有未協調的同檔平行覆寫。

## 實際完成

1. 一帳號多組織 admin／staff 與 active／suspended 資格，舊 home 與資料不搬移；切換後以有效資格授權所有 API、CSV 及報表。
2. 既有帳號接受另一組織邀請，匹配身份與 CSRF、限時單次、issuer 現有資格重驗；不改原密碼及其他組織 grants。
3. 資格暫停與全平台 disabled 分開；全域 owner 保留全平台停用與既有帳號密碼變更，相關 Session 撤銷。
4. 報名重送 key 的資料庫映射，完整相同內容回同結果，並行不多建；變更／跨活動／逾期拒絕。
5. 優先 UX 修正：admin 邀請漏欄位、身份切換殘留、晚到回應、重試阻擋；補探索來源、報名摘要、結果保存及待授權說明。
6. schema30 先備份再增量交易、重啟冪等，保留原資料；快照包含會員、查詢 key 映射並檢查關聯。
7. 公開活動列表以聚合 SQL 取回容量及組織資料，減少每活動額外查詢；新增必要索引。沒有以此宣稱完成負載／效能基準測試。

## UX 盤點對照

| 原項目 | 本版結果 |
| --- | --- |
| UX01 admin 邀請漏必要欄位 | 已修；明確組 payload 並執行 handler 回歸 |
| UX02 遺失查詢碼安全找回 | 尚未實作；增加保存提醒，不能當作已找回 |
| UX03 送出結果不確定 | 已實作原分頁相同 key／內容重試；重新整理及跨裝置仍有限制 |
| UX04 身份切換殘留 | 已加完整清理、generation 防舊回應重顯；驗證依 QA／瀏覽器紀錄 |
| UX05 組織來源流失 | 改善 org／搜尋／分類／排序上下文及返回連結 |
| UX08 加入後無活動引導 | 已補待授權狀態與提示，不預設擴大工作人員權限 |
| 其他 UX 項目 | 僅按實際修改標示；付費支付、完整取消自助、離線核銷及裝置矩陣未宣稱完成 |

## 測試、資料與 Git 交付

正式資料修改前已建立驗證完整快照與原始碼備份；所有合成報名、核銷、停權、遷移與還原測試用暫存資料。沒有寄出真實 SMTP，沒有破壞性正式還原。完整測試結果見 TEST_RESULTS_V3.0.md，安全與 QA 報告另附。

只有最終安裝後 npm run check、npm test 與 Git diff 檢查通過，且子代理結果已收到後，主代理才建立 V3.0 Commit。主分支不自動合併，正式服務由使用者重啟驗收。

## 未完成與風險

安全自助查詢碼找回、全部 membership 失效後的獨立身份登入、真實 SMTP／HTTPS／實體裝置驗收、共享限流、退信回執、異地加密備援及負載／滲透測試仍未完成。單一服務支援方式、排程依服務存活、備份不自動刪除等原限制保留。正式重啟需檢查 migration30 並按 README_V3.0.md 做角色及裝置驗收。

## 最終交付結果

五個子代理均已完成並回報，主代理安裝至 D:\Coding\EventFlow 後完成 35 檔檢查、24 項測試全部通過（0 失敗、0 略過）。正式資料 schema 29、完整性與外鍵正常，原資料完整保留；首次正式啟動才遷移 30。原生瀏覽器僅實測登入與 Dashboard，組織切換、邀請、登出與公開報名的完整實際操作仍待人工驗收。Git 差異檢查通過後在開發分支建立 Commit，未自動合併主分支。
