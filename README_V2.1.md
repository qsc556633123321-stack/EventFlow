# EventFlow V2.1｜後台整合與詳細系統藍圖

本版以 V2.0 原始碼直接升級，保留 Express + SQLite、活動建立與報名、管理後台、品牌圖片、Demo 範例、公開 HTTPS Tunnel。

## 新增
- `/blueprint.html`：重新製作的詳細系統建置藍圖，涵蓋七階段、前後台功能、資料需求、系統分層、資料流、真實資料表欄位、角色與公開連線、已完成／規劃功能清單。
- `/blueprint21.css`：桌機、手機與 A3 橫向列印版面。
- 後台總覽新增藍圖入口與 V2.1 說明，更新版本識別。
- `/api/health` 版本升級至 2.1.0。

## 重要：功能盤點
V2.0 的 `events.custom_fields` 與 `registrations.custom_answers` 目前採 JSON 欄位，**並無獨立 form_fields 或 registration_answers 資料表**。`checkins`、`notifications` 尚未建立，現場簽到、Email 通知、候補與完整統計皆屬後續規劃。藍圖依實際程式標示，並非宣稱全部完成。

## Windows 啟動
```powershell
npm install
npm start
```
開啟 `http://localhost:3000`，管理後台 `http://localhost:3000/admin.html`，藍圖 `http://localhost:3000/blueprint.html`。

## 線上課堂公開模式
另開 PowerShell：
```powershell
cloudflared tunnel --url http://localhost:3000
```
把終端機提供的 `https://....trycloudflare.com` 網址分享給同學。Windows 電腦、EventFlow 和 Tunnel 必須保持執行；請用測試資料。

## 升級舊資料
先關閉舊版程式，備份 V2.0 的 `data/` 和 `public/uploads/`，再複製到 V2.1 同位置。不要把資料庫或個資檔案放進公開網頁目錄。**此 ZIP 不包含你的本機資料庫**。

## 驗收
1. 後台登入後切換活動／報名／品牌／備份分頁。
2. 開啟詳細藍圖，檢查資料欄位、資料表與開發狀態。
3. 建立 Demo 活動，外部裝置經 HTTPS 網址填寫測試報名。
4. 管理後台查詢與審核，重新啟動後確認資料仍存在。

## 安全提醒
V2.1 是課堂測試版，**未經完整公開服務安全稽核**。勿用於正式收集敏感個資，公開前確認管理員密碼、檔案上傳及後台權限。
