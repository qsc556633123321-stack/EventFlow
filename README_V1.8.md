# EventFlow V1.8｜品牌客製化與圖片管理

## 啟動
Node.js 22.13+（需內建 node:sqlite）。在 EventFlow 資料夾執行 `npm install`、`npm start`。公開首頁 http://localhost:3000；後台 http://localhost:3000/admin.html；建置藍圖 http://localhost:3000/blueprint.html。

## 新增
- 品牌名稱、品牌色、介紹文字、Logo、首頁 Banner
- 活動分類（旅遊／講座／營隊／體驗）
- 活動封面圖片上傳（PNG/JPEG/WebP；每張上限 3MB）
- 主辦單位專屬活動首頁：後台「品牌與圖片」中的預覽連結 `/?org=<id>`
- 既有資料庫自動新增欄位，不刪除既有活動或報名資料

## 使用
先登入後台，進入「品牌與圖片」，設定品牌資料並儲存，選擇 Logo／Banner 圖片上傳；選擇活動上傳活動封面。可開啟專屬網站連結確認效果。建立活動時可選擇活動分類。

## 注意
- 請先備份 V1.7 的 `data/` 目錄，並在停止舊版伺服器後將它複製至新版專案。
- 圖片存於 `public/uploads/`，搬移部署時需一起備份。
- 這是課程 Demo，正式上線還需要完善檔案安全掃描、CSRF 防護、備份與多租戶權限。
- 既有備份 API 仍沿用舊格式，不包含新增的圖片檔案與品牌欄位；請備份完整 `data/` 與 `public/uploads/`。
