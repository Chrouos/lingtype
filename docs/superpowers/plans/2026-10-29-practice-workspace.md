# 英文打字練習工作區 Implementation Plan

**Goal:** 完成可匯入教材、挑選單字、練習英文並查看表現的本機應用。

**Architecture:** 維持現有 HTML、CSS、ES modules 和 Python 本機伺服器；計算邏輯與儲存邏輯維持獨立，介面使用既有教材格式與翻譯 API。

**Tech Stack:** 原生 JavaScript、CSS、Python、Node test runner。

## 工作

1. 加入練習中的經過時間、WPM、正確率與進度；定義零輸入、錯字修正及單字模式的計算方式並測試。
2. 提供近期練習紀錄與匯入教材刪除，處理舊資料、儲存失敗及空資料。
3. 整理練習區與教材操作、手機版、空狀態及載入／錯誤狀態，保留既有匯入與翻譯功能。
4. 執行 JavaScript、Python 測試、語法及介面檢查，嘗試瀏覽器實際操作，記錄任何驗證限制。

## 注意事項

- 不覆蓋使用者既有未提交變更。
- 翻譯失敗時仍可練習；不顯示虛構成績。
- 速度使用正確字元數除以五，再除以經過分鐘數；正確率以目前輸入為準。
- 不要求帳號，教材和紀錄留在目前瀏覽器。

## 驗證紀錄（2026-10-29）

- 介面重新設計：淺色（含深色模式）單欄版面，打字卡片為主體；精簡說明文字，次要操作收進「更多」。
- 介面語言跟隨語言選單（繁中／日／韓），`test/i18n.test.mjs` 檢查三種語言的字串鍵與參數一致、頁面與程式用到的鍵都存在。
- 介面檢查（inspect.mjs --app）：0 FAIL 於練習頁；匯入／紀錄頁的「no-title」為多頁籤結構誤判（顯示中的頁籤有 h1）。

### 最新狀態（commit 984ef2f，分支 `reader-imports-notebook`）

- `node --test test/*.test.mjs`：43 通過；`python -m unittest discover -s test -p 'test_*.py'`：29 通過。
- `node test/browser-e2e.mjs`：以 `LINGTYPE_URL=http://127.0.0.1:8766/` 指向另開的測試伺服器時全部通過（含 YouTube 匯入、單字本、閒置暫停計時）。
- 已完成：介面三語、閱讀式滿版版面、連續練習與 Esc 結束、句號後要打空白、多來源匯入（YouTube／網頁／arXiv／PDF／DOCX／EPUB／TXT／MD／HTML／SRT／VTT）、長文自動分段、MyMemory 翻譯備援、YouTube 人工字幕當翻譯、單字本。
- 限制：本機網路的 Google 翻譯被擋，改用 MyMemory（每天約 5000 字元）；YouTube 因測試時請求太多暫時封鎖此 IP（IpBlocked），之後需重新驗證。

## 下一步（2026-10-30 起）

### 先做

1. 把 `reader-imports-notebook` 開 PR 合併進 `main`（https://github.com/Chrouos/lingtype/pull/new/reader-imports-notebook）。
2. 換電腦或重新拉取後：`python -m pip install --target .deps -r requirements.txt`（新增 pypdf、youtube-transcript-api），並重新啟動 `python server.py`。
3. YouTube 封鎖解除後重新驗證：
   - 匯入 `https://www.youtube.com/watch?v=arj7oStGLkU`，確認逐句中文翻譯立即出現，且不再有「（笑聲）」等全形括號標記。
   - 跑一次 `node test/browser-e2e.mjs`（想略過 YouTube 可設 `LINGTYPE_SKIP_NETWORK=1`）。
4. 確認單字本裡自己加的字（例如 small、garden、behind）的翻譯有補上，而不是一直顯示「—」。

### 值得做

5. YouTube 沒有人工中日韓字幕時，用 YouTube 自動翻譯字幕（`transcript.translate('zh-Hant')`）當翻譯；此網路測試時被擋，需在可用的網路驗證。
6. 翻譯額度：MyMemory 一天約 5000 字元，一場 TED 就用完。考慮加上可選的 API 金鑰設定（例如 DeepL 或 Google Cloud Translation）。
7. 教材庫頁面：教材一多下拉選單太長，需要改名、刪除、看進度；也讓匯入後能修改標題與內容。
8. 單字本：
   - 加上複習日期（間隔重複），而不只依打錯次數排序。
   - 單字本的匯出／匯入（目前只存在瀏覽器）。
   - MyMemory 的單字翻譯品質不穩（例如 library 翻成「媒體櫃」），可改用例句上下文翻譯或讓使用者自己改譯文。
9. 掃描成圖片的 PDF 需要 OCR 才能匯入。
10. 測試：`test/browser-e2e.mjs` 依賴 `.agents/` 內設計技能的 CDP 小工具（已列入 .gitignore，靠 `skills-lock.json` 重新安裝）；考慮改成專案自己的瀏覽器測試工具。
11. 在真的手機鍵盤上試打一次（輸入框跟著游標的做法目前只在模擬的 390px 寬度測過）。
