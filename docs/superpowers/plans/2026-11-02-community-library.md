# 社群書房實作計畫

**Goal:** 為公開文章提供封面、互動、排行、匿名使用和 Google 登入後的個人進度。

**Architecture:** 延伸現有 Python/SQLite API 與前端公開教材頁，保留既有教材與下架權限。登入 session 與個人資料留在伺服器，未登入進度留在瀏覽器。

**Tech Stack:** Python、SQLite、原生 JavaScript、HTML/CSS。

**Spec:** `docs/superpowers/specs/2026-11-02-community-library-design.md`

1. 以測試先行新增互動資料表、按讚與留言 API，限制輸入並保留舊資料。
2. 加入封面驗證和存取、文章練習紀錄與排行，測試遷移及錯誤輸入。
3. 加入 Google OAuth、session 與跨裝置資料同步；環境沒有憑證時明確顯示未設定。
4. 將公開頁改為書架及文章詳情，接入匿名互動、上傳封面、排行及登入。
5. 驗證桌機與手機流程、權限邊界和現有測試；提供部署設定說明。
