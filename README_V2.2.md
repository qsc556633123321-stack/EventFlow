# EventFlow V2.2｜營運統計與穩定性延伸版

以 V2.1 原始碼升級，保留原有活動、報名、後台、品牌圖片、Demo、詳細藍圖與公開 Tunnel。

## 新增
- 後台登入後可查看每場活動已確認人數、待審核人數與剩餘名額；支援手動重新整理。
- `GET /api/admin/stats`：依登入角色權限限制可見活動，統計報名狀態與人數。
- `GET /api/admin/audit`：僅 owner 可讀取最近 60 筆操作紀錄。
- 版本識別更新為 V2.2。

## 啟動（Windows PowerShell）
1. 安裝 Node.js 22.13 或更新版本。
2. 在 EventFlow 資料夾執行 `npm install`，再執行 `npm start`。
3. 開啟 `http://localhost:3000`，後台 `http://localhost:3000/admin.html`。
4. 若需讓同學遠端開啟，另開終端執行 `cloudflared tunnel --url http://localhost:3000`，分享 HTTPS 網址。

## 驗收
- 後台登入、活動建立、Demo 建立、報名、審核與統計數字更新。
- 手機瀏覽公開首頁與報名表。
- 非登入狀態呼叫 `/api/admin/stats` 應回傳 401。
- 一般管理員呼叫 `/api/admin/audit` 應回傳 403。

## 資料保存
ZIP 不含個人資料庫。升級前備份原本的 `data/` 和 `public/uploads/`，停機後再搬到新版對應位置。

## 注意
本版為課堂測試用途，尚未完成全面安全稽核；請勿公開蒐集敏感個資。
