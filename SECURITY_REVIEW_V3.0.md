# EventFlow V3.0 資安檢查紀錄

日期：2026-11-25（Asia/Taipei）。角色：資安工程師子代理。範圍為隔離開發副本；未修改正式資料、未寄送郵件、未執行外部滲透測試。

## 已實作的安全邊界

- `modules/security.js`：登入只由 `users.role=owner` 判斷平台管理員；非 owner 登入選有效 home membership，否則第一個 active membership。完全沒有有效資格時拒絕登入。
- 每次已登入請求重新查詢全域帳號停用狀態、Session 到期與組織資格。非 owner 的有效角色／工作人員範圍只來自 Session 指向組織的 active membership，不回退舊 `users.role/organization_id/staff_mode`。
- `modules/policy.js`：每次授權重新確認帳號及 membership，傳入舊的 `role` 欄位不能恢復被撤銷權限。owner 仍受已選定組織範圍限制。
- 工作人員授權比對活動實際組織、目前組織與有效 membership；只接受 read／review／checkin／export 操作。指定活動授權及整個組織模式沿用既有規則。
- 保留 Cookie HttpOnly／SameSite、Session 綁定 CSRF、同來源寫入檢查、參數化 SQL、登入速率限制與統一 API 錯誤。
- `modules/validation.js` 無需變動；新的 Idempotency-Key 由報名模組驗證 32–64 hex，既有輸入驗證繼續生效。

## 已執行的獨立驗證

以本機隔離伺服器、暫存 SQLite、SMTP 停用執行 HTTP 與 policy 驗證，結果 **PASS**：

1. 同一帳號在 A 組織為 admin、B 組織為 assigned staff，切換後 `/api/me` 回傳有效 staff 角色，保留 platformRole 及兩個組織選項。
2. 既有帳號接受新組織邀請：缺少 CSRF 403、錯誤帳號 403、正確帳號成功、重複使用拒絕。
3. 未加入第三組織、非 owner 切全域、缺少 CSRF 的組織切換皆拒絕。
4. A 組織 Session 無法讀 B 報名；B 的未授權 staff 看不到活動；加入指定活動權限後可看授權活動，沒有 export 權限仍不能下載 CSV。
5. owner 選定 B 後不能建立 A 活動，也不能操作需全域範圍的完整快照。
6. 傳入偽造 `role=owner` 或過期 `role=admin` 的 policy 物件，不會讓非 owner 取得 B 管理或審核權限；偽造活動所屬組織亦拒絕。
7. membership 直接暫停後，舊 Session 下次請求立即失效；所有 membership 暫停不能重新登入。
8. 全域 `users.disabled=1` 時，policy 與登入皆拒絕，即使 membership 仍為 active。

語法檢查：`node --check modules/security.js`、`node --check modules/policy.js` 均通過。完整測試與正式交付由主代理整合後執行；本紀錄不取代 QA 測試報告。

## 其他模組檢視

- 邀請接受交易會重新驗證建立者目前在目標組織的 admin 資格或平台 owner 身份；既有帳號必須以相符 Session 與 CSRF 證明身份；不因邀請而改原密碼、home organization 或別組織 grants。
- 成員 API 的普通 disabled 只作用於指定 membership；globalDisabled 及全域密碼變更限 owner 全域操作；不能透過組織管理重新啟用平台停用帳號。
- 報名重送保存 key 雜湊與 canonical request 雜湊，在同一寫入交易內映射原報名。只有相同識別碼、相同活動及完整原內容才回傳原結果，不能用 key-only 查詢私人憑證。過期映射明確拒絕，不另建立報名。
- migration 30 以 active staff membership 驗證逐活動 grants；snapshot schema 30 保存 memberships，還原仍撤銷 Session／帳號連結並暫停待送通知。

## 尚待正式環境驗收與限制

- 真實 SMTP TLS、HTTPS Tunnel／反向代理、安全 Cookie 與實體裝置未在本次驗證；不宣稱完整弱點掃描、滲透、負載測試或資安認證。
- 速率限制仍為單程序記憶體；多節點共享限流、外部不可變稽核、異地加密備份不屬於本次已完成範圍。
- 單一帳號全部 membership 暫停時不能登入，因此亦不能直接接受另一組織的既有帳號邀請；目前需管理員先恢復有效資格。這是身份復原流程限制，不應以回退舊角色繞過。
- 安全自助找回報名查詢碼尚未實作，不能把帳號密碼重設誤當作報名憑證找回。
