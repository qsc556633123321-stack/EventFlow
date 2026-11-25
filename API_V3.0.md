# EventFlow V3.0 API 與即時通訊契約

日期：2026-11-25。版本 3.0.0、SQLite schema 31。以 `server.js` 與實際 `modules/*.js` 路由為準；本文件區分一般會員與後台帳號用途，不把規劃中的路由列為已存在。

## 身份、CSRF 與錯誤

| 用途 | Cookie／Session | 取得 CSRF | 限制 |
| --- | --- | --- | --- |
| 後台 | `ef_session`、`sessions.audience='admin'` | `GET /api/me` 的 `csrfToken` | 只有平台 owner 或有效組織 admin／staff；一般 `users.role='member'` 不能登入後台 |
| 一般會員 | `ef_member_session`、`audience='member'` | `GET /api/member/me` 或會員登入回應 | 必須有 active profile，帳號未全域停用；社群與會員關聯報名另需 Email 已驗證 |
| 訪客 | 不需要會員 Cookie | 不適用 | 保留原公開活動、訪客報名與編號＋查詢碼查詢 |

兩種 Cookie 均為 HttpOnly、SameSite=Strict、Path=/，HTTPS／COOKIE_SECURE=1 時為 Secure。把會員 Cookie 改名為後台 Cookie 仍不能通過 audience 檢查。會員資料與後台角色使用同一 users 身份，不重複建立帳號。

一般會員受保護寫入與後台寫入需 `X-CSRF-Token`。公開註冊、登入、Email Token 完成、忘記／重設密碼是明確例外。原始頭像上傳使用圖片 Content-Type 而非 JSON；其他 API 寫入使用 `application/json`。來源檢查及 Cookie 規則仍適用。

錯誤回應維持 `{error,code,requestId}`；常見 HTTP 狀態為 400 格式錯誤、401 未登入、403 權限／CSRF、404 不存在、409 衝突、413 過大、415 Content-Type、429 速率限制。不能以非 2xx 內容當成功。會員註冊、登入、重設與聊天有各自速率限制，記憶體限制僅支援單程序。

## 一般會員與個人中心

以下路徑均以 `/api/member` 開頭。P=公開、M=有效會員 Session＋寫入 CSRF、V=M 且 Email 已驗證。

| 方法／路徑 | 驗證 | 請求 | 實際成功回應與行為 |
| --- | --- | --- | --- |
| POST `/register` | P | `{email,password,nickname,name?,phone?}` | `{ok,deliveryStatus,message}`；密碼 12–256 字、暱稱最多 40 字；建立 role=member、無組織資格，排入驗證通知。既有 Email 409，不覆寫帳號；不自動登入、不回傳 Token |
| POST `/login` | P | `{email,password}` | 會員 payload，設定會員 Cookie；既有管理帳號可用正確原密碼開通公開 profile，仍需 Email 驗證 |
| POST `/logout` | M | `{}` | `{ok:true}`；撤銷目前會員 Session、即時連線重驗，不等於登出後台 Session |
| GET `/me` | M | 無 | `{member,csrfToken,preferences,unreadCount}` |
| POST `/verification/request` | M | `{}` | `{ok,deliveryStatus?,message}`；24 小時驗證通知，已驗證不重發 |
| POST `/verification/complete` | P | `{token}` | `{ok,message}`；單次有效、到期或已使用回 400 |
| POST `/password/request` | P | `{email}` | 通用 `{ok,message}`，不透露帳號存在與否；未設定 SMTP 不聲稱已寄出 |
| POST `/password/reset` | P | `{token,password}` | 30 分鐘單次 Token；更新同一身份密碼並撤銷所有 Session |
| PUT `/password` | M | `{currentPassword,password}` | `{ok,message}`；檢查舊密碼，撤銷所有 Session 及未使用會員 Token |
| PUT `/profile` | M | `{name,phone,nickname,commonAnswers?}` | `{ok,member}`；不修改歷史報名。`commonAnswers` 為安全 key 的字串、有限數字、布林或字串陣列 |
| POST `/avatar` | M | raw PNG／JPEG／WebP，最多 3MB | `{ok,url}`；檢查 magic bytes、隨機檔名寫入 uploads；不接受任意遠端頭像網址 |
| POST `/account-request` | M | `{type:'disable'|'delete',currentPassword}` | `{ok,message}`；只將公開 profile 改為 disabled／deletion_requested，撤會員 Session，保留報名、聊天與管理資格歷史，不直接硬刪除 |
| GET `/registrations` | M | 無 | `{rows}`，只有 `member_user_id` 為本人之報名；含 eventId、title/date/location、eventStatus、報名狀態及歷史答案快照；不回傳 lookup_code |
| POST `/registrations/claim` | V | `{id,code}` | `{ok:true}`；查詢憑證與已驗證會員 Email 均須匹配，不能認領他人的已綁定報名，不可只靠 Email 自動認領 |
| GET `/registrations/:id/ticket` | V | 無 | `{id,title,date,location,participants,payload,checkedIn,qr}`；必須本人、confirmed，活動未封存／草稿／取消。非本人 404，無資格 409 |
| GET `/directory?q=` | V | 2–60 字暱稱或公開識別碼 | `{rows:[{publicId,nickname,avatarUrl}]}`，最多 30 人；排除本人、無效／未驗證及雙向封鎖，不公開手機或 Email |

`member` 的公開給本人 payload 欄位為 `id,publicId,email,name,phone,nickname,avatarUrl,commonAnswers,verified,status`。`preferences` 回應為 `{preferences:{...},dmPolicy,showPresence}`。member id 是本人中心用途；社群對外使用 publicId，不回傳他人的私密聯絡資料。

驗證／重設 Token 只以 SHA-256 儲存於 member_tokens。寄送內容以現有 account-mail.key 的 AES-256-GCM 加密進入 member_mail_outbox；未設定 SMTP／PUBLIC_BASE_URL 時 deliveryStatus=preview，不透過 API 公開驗證連結。

## 會員活動報名與舊訪客相容

`POST /api/events/:id/register` 保留原 body：`{name,phone,email,participants,notes?,customAnswers?}` 及回應 `{id,status,lookupCode}`。

- 無會員 Cookie 時，原訪客流程仍可使用；活動 `memberRequired=true` 則回 401。
- 有有效會員 Cookie 時，需 Email 已驗證及會員 CSRF；後端從 Session 決定 `member_user_id`，忽略使用者自行指定的擁有人。個人資料只預填，不因單次報名修改而覆寫 profile。
- optional `Idempotency-Key` 為 32–64 位十六進位。同 key、活動、型別保留的 canonical body 在 24 小時內恢復同筆結果；會員報名的重送也須登入原會員。內容／活動不符或逾期 409，不另建報名。
- 保留舊 `customAnswers`、`customFields`、`field_snapshot`；新支援 `radio`（字串）、`multiselect`（字串陣列）、`consent`（布林）。必要姓名／手機／Email／報名人數仍由伺服器檢查。
- `GET /api/events`、`GET /api/events/:id`、`POST /api/registrations/lookup {id,code}`、`POST /api/registrations/ticket {id,code}` 保留。待審核／候補不能取得正式 QR。

## 統一通知中心

| 方法／路徑 | 請求與回應 |
| --- | --- |
| GET `/api/member/notifications?kind=&before=&limit=` | 會員身份；limit 1–100、before 正整數，按 id 降冪；`{rows,unreadCount,nextCursor}`。rows 為本人 `id,kind,title,body,href,created_at,read_at` |
| POST `/api/member/notifications/read` | M；`{id}`，只修改本人通知，回 `{ok,unreadCount}` |
| POST `/api/member/notifications/read-all` | M；`{}`，回 `{ok:true,unreadCount:0}` |
| PUT `/api/member/preferences` | M；`{preferences:{kind:boolean,in_app?:boolean},dmPolicy:'open'|'requests'|'closed',showPresence:boolean}`，回 `{ok,preferences}` |

實際 kind：`registered`、`confirmed`、`rejected`、`cancelled`、`waitlist_promoted`、`event_cancelled`、`event_changed`、`event_upcoming`、`announcement`、`direct_message`、`message_request`、`mention`、`system`。

註冊／審核／遞補及活動取消／時間異動由真實資料變動產生；即將開始提醒由真實 confirmed 報名與活動時間排程產生並去重。聊天室實際訊息、請求、公告及 @publicId 提及產生對應通知。沒有展示用假通知。偏好可禁止某 kind 或所有站內通知。DM closed 指不接受新對話；既有已接受對話仍保留，封鎖才拒絕雙方對話存取。

## 社群 HTTP API

所有一般社群路由需 V（有效會員＋Email 已驗證，寫入需 CSRF）。public 房間 ID 固定為 `public`；活動房間 `event:<活動ID>` 依啟用活動懶建立；直接對話 ID 為不透明識別碼。

| 方法／路徑 | 請求／回應 |
| --- | --- |
| GET `/api/community/rooms` | `{rows}`，含 id/kind/eventId/title/state/requestPending/canAccess/unreadCount/peer/lastMessage；僅可知的房間與本人訊息請求 |
| POST `/api/community/direct` | `{publicId}` → 房間摘要；canonical pair 防重複，尊重雙向封鎖及新私訊政策 |
| POST `/api/community/rooms/:id/request` | `{accept:boolean}` → `{ok:true}`；只有 pending 接收者能決定，接受前雙方不能讀傳訊息 |
| GET `/api/community/rooms/:id/messages?before=&after=&limit=` | `{rows,nextCursor}`；limit 1–100，不可同時 before/after。舊訊息 before、斷線補訊 after，回應顯示順序為正序 |
| POST `/api/community/rooms/:id/messages` | `{body}` → `{message}`；純文字 1–2000 字，10 次／10 秒／會員，並檢查禁言 |
| GET `/api/community/rooms/:id/pins` | `{rows}`，最多 20 個可讀置頂訊息，不只限目前歷史頁 |
| POST `/api/community/rooms/:id/read` | `{lastReadId}` → `{ok,lastReadId}`；單調遞增，不能標任意未來或其他房間的訊息 |
| GET `/api/community/rooms/public/presence` | `{rows:[{publicId,nickname,avatarUrl}]}`；只顯示已加入、有效且允許公開在線狀態者，尊重封鎖 |
| POST `/api/community/reports` | `{messageId,reason}` → `{id,status:'open'}`；需原本可讀該訊息，原因 1–500 字，有限流 |
| POST `/api/community/blocks` | `{publicId}` → `{ok:true}`；自己不能封鎖自己，更新後重驗即時存取 |
| GET `/api/community/blocks` | `{rows:[{publicId,nickname,avatarUrl,createdAt}]}`；只有本人封鎖清單 |
| DELETE `/api/community/blocks/:publicId` | `{ok:true}`；只解開本人建立的封鎖關係 |

訊息 DTO：`{id,roomId,body,kind,pinned,createdAt,sender:{publicId,nickname,avatarUrl}}`。不存在任意會員 Email／手機查詢 API。

活動聊天室：member policy 允許已驗證會員；confirmed 允許本活動已確認且綁定的會員，並允許具備本活動管理／指定工作資格者；staff 只允許目標組織有效 admin 或具活動權限的 staff（平台 owner 可管理）。取消、封存、草稿、關閉 chat 或權限失效會重新拒絕加入、讀取及傳送。

## 社群管理 API

以下用後台 `ef_session`＋CSRF，不以一般會員 Session 管理。

| 方法／路徑 | 請求／回應 |
| --- | --- |
| GET `/api/admin/community/rooms` | `{rows:[{id,kind,eventId,title}]}`；只列可管理的非私聊房間 |
| GET `/api/admin/community/reports` | `{rows}`；必要被檢舉訊息、原因、狀態及公開識別資料，每筆讀取產生稽核；不是私聊整段歷史 |
| POST `/api/admin/community/rooms/:id/announcement` | `{body,pinned?}` → `{message}`，只可對公共／活動房間公告 |
| POST `/api/admin/community/messages/:id/pin` | `{pinned:boolean}` → `{message}`，禁止私聊置頂管理 |
| POST `/api/admin/community/rooms/:id/mute` | `{publicId,minutes,reason?}` → `{ok,untilAt}`；minutes 0–10080，0 可解除禁言 |
| POST `/api/admin/community/reports/:id/resolve` | `{status:'resolved'|'dismissed',resolution?}` → `{ok:true}`，記錄操作者與時間 |

公共／私人檢舉僅平台 owner 全域可處理；組織 admin 只能管理所屬活動房間及其檢舉。沒有提供一般管理員任意列出私人聊天、搜尋全部私訊或下載他人歷史的路由。

## Socket.IO 契約

同源 `/socket.io`，使用會員 Cookie，連線 auth `{csrfToken}`。握手來源與頻率檢查、未驗證會員拒絕。每次事件與收件人送達前重新解析 Session／房間資格；不是只在握手驗證一次。Socket.IO middleware 僅每連線執行一次，因此實作另外驗證每次操作；參見 [官方 middleware 說明](https://socket.io/docs/v4/middlewares/)。

| 客戶端事件 | payload | acknowledgment |
| --- | --- | --- |
| `room:join` | `{roomId,afterId?}` | `{ok:true,room,rows,nextCursor}`，或錯誤 |
| `message:send` | `{roomId,body}` | `{ok:true,message}` |
| `room:read` | `{roomId,lastReadId}` | `{ok:true,lastReadId}` |
| `typing` | `{roomId,typing:boolean}` | `{ok:true}`；受在線隱私與 8 次／3 秒限制，不持久化 |

伺服器事件：`message:new {roomId,message}`、`message:updated {roomId,message}`、`room:read {roomId,publicId,lastReadId}`、`typing {roomId,publicId,nickname,typing}`、`presence {roomId,rows}`、`room:revoked {roomId,message}`、`notification <本人已持久化通知>`。錯誤 acknowledgment 為 `{ok:false,error,code}`，此處 code 為 HTTP 類數字狀態。

連線不把 membership 或聊天室成員狀態當永遠有效：Session 變動事件及每秒檢查撤銷失效連線；HTTP mutation、報名取消、封鎖與聊天室資格改變會重驗。每次房間推送逐收件人檢查，避免留在舊 room 的使用者繼續收取。重新連線使用資料庫 after 游標補訊，不依賴可跳過 middleware 的恢復設定。未實作離線傳送佇列或 exactly-once 聊天重送。

## 表單設計器與活動精靈

| 方法／路徑 | 用途與回應 |
| --- | --- |
| GET `/api/admin/form-templates?organizationId=` | owner／admin；內建＋可管理組織範本陣列 `{id,name,organizationId,builtin,fields,settings,createdAt,updatedAt}` |
| POST `/api/admin/form-templates` | `{name,fields,settings?,organizationId?}` → `{id,ok:true}`；持久化自訂範本與稽核 |
| PUT `/api/admin/form-templates/:id` | 同內容 → `{id,ok:true}`；不能覆寫內建範本、不能跨組織 |
| DELETE `/api/admin/form-templates/:id` | `{ok:true}`；內建不可刪除 |
| POST `/api/admin/events/:id/publish` | `{}` → `{ok:true,id}`；伺服器檢查名稱、日期、地點、名額與有效表單，拒絕已取消／封存 |
| GET `/api/admin/dashboard` | 真實、目前授權範圍的營運數字，見下方定義 |

活動 POST／PUT 原 keys 保留，新增 `memberRequired`、`chatEnabled`、`chatJoinPolicy`（members/confirmed/staff）、`formSettings`、`notificationSettings`、`startsAt`、`endsAt`。開始／結束時間若提供為 ISO 可解析字串，結束不得早於開始。精靈先保存 draft 再 publish；舊 API 直接設定 open 的相容路徑保留，不能把新發布檢查誤當所有歷史 API 的破壞性必填變更。

customFields 支援 `text,textarea,number,date,select,radio,multiselect,consent`。每欄保留 id/label/type/visible/required/options，新增 hint、placeholder、defaultValue、validation（min/max/minLength/maxLength），不接受任意 regex。`formSettings` 使用 `{system:{name,phone,email,participants,notes},layout:'stacked'}`，每個系統欄位為 hint／placeholder／defaultValue 設定；必要系統欄位不能移除。設計器測試填寫只在前端驗證，不產生正式報名。

dashboard 回應：`activeEvents,totalParticipants,pendingParticipants,waitlistedParticipants,todayCheckins,upcomingEvents,failedNotifications,pendingReports`。activeEvents 為未封存、open 且日期未過的活動；totalParticipants 為 confirmed/pending/waitlisted 人數；todayCheckins 為台北日曆日的核銷人數；failedNotifications 計授權範圍 failed/uncertain 報名與帳號郵件，平台 owner 另含會員郵件；pendingReports 為可管理範圍 open 檢舉。upcomingEvents 最多五場實際日期未過活動。無付款資料模型，沒有假付款狀態。

## 既有管理與維護介面

組織、成員、邀請、品牌、報名審核／候補、核銷、CSV、報表、Email 佇列、稽核及完整備份路徑保留，授權仍為目前有效組織與逐活動權限。一般會員的停用是 profile 狀態，不會順帶鎖住該身份既有管理資格。

`POST /api/admin/invitations` 可向一般會員發出明確組織邀請。只有匹配且 Email 已驗證的會員 Session＋會員 CSRF＋有效單次邀請才能接受並新增組織資格；一般註冊／登入不會取得此資格。後台用途仍需另行後台登入，不能把會員 Session 當後台 Session。

本文件依實際路由產生；完整自動測試與待人工驗收結果見 TEST_RESULTS_V3.0.md。未提供退信 Webhook、付款、語音／視訊、離線核銷或多節點共享限流 API。


## 會員郵件管理補充

- GET `/api/admin/member-notifications`：平台 owner 後台 Session，回 `{rows}`；每列含 id/kind/email/subject/status/attempts/error/time/delivery_state/memberNotification，不回 Token 或郵件秘密 payload。
- POST `/api/admin/member-notifications/:id/retry`：平台 owner＋後台 CSRF。缺 SMTP／PUBLIC_BASE_URL 回 409；sent、sending、uncertain、Token 已用／過期及停用 profile 不重寄。
- 邀請資訊針對一般會員身份回 `requiresMemberLogin:true`；接受有效邀請後仍須 POST `/api/login` 才有後台 Session。
- 活動 `notificationSettings.announcements=false` 時公告訊息仍保存／即時傳送，但不建立該公告站內通知。


安全補充：modules/identity-security.js 統一共享身份密碼變更的撤銷；後台／會員重設、會員變更密碼及 owner 設密碼皆撤銷兩種 Session 與所有未使用 reset 連結。個人停用／刪除只更新 profile 請求狀態，不自動抹除歷史；實際刪除處理與恢復由管理維運流程執行。
