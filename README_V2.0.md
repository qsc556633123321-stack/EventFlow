# EventFlow V2.0 — 線上課堂公開展示版

## 本機啟動
需要 Node.js 22.13+。執行 `npm install`、`npm start`，在本機開啟 http://localhost:3000 。**先在本機完成初次管理員設定**，再公開網址。

## 公開 HTTPS 網址（建議 Cloudflare Quick Tunnel，測試用途）
1. 安裝 Cloudflare cloudflared（請從 Cloudflare 官方網站下載），不用更改路由器設定。
2. 在第一個終端機執行 `npm start`，保持執行。
3. 在第二個終端機執行 `cloudflared tunnel --url http://localhost:3000`。
4. 終端機顯示 `https://...trycloudflare.com` 公開網址後，分享給遠端同學；電腦與兩個終端機都必須保持開啟。
5. 結束課堂後停止 cloudflared，公開網址即停止轉送。Quick Tunnel 網址通常每次不同，不保證可用性，正式部署應使用受管理的固定網域 Tunnel。

**請勿把 /admin.html 管理網址、管理員密碼或真實個資分享給測試者。** 公開展示建議只使用虛構報名資料。HTTPS Tunnel 只負責傳輸加密，不能取代身分驗證、備份與安全檢查。

## V2.0 檢驗
- GET `/api/health` 應回應 `{"ok":true,"version":"2.0.0"}`。
- 遠端裝置打開公開網址可看活動、進入活動詳情、送出測試報名；本機管理後台可查詢該筆報名。
- 首次設定管理員只能在本機操作（除非自行設定 `ALLOW_REMOTE_SETUP=1`，**不建議**）。
- 同源限制拒絕帶有其他 Origin 的修改請求；請使用 HTTPS 公開網址操作。

## 注意事項
此版為**課堂測試版**，不是完成安全稽核的正式商用部署。伺服器需持續運行，關機或網路斷線後遠端無法連線。SQLite 及上傳圖片仍保存在本機，請定期備份 `data` 與上傳檔案。現有 V1.9 功能沿用，詳細藍圖為設計目標，不代表每個功能已經實作。
