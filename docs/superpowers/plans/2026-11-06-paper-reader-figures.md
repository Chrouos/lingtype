# 論文閱讀模式：圖片、公式與 PDF 頁面（計畫）

目標：貼上 arXiv 網址（abs / html / **pdf** 都可）或上傳 PDF，就能一邊打字練習、一邊看到這段文字對應的圖表。

## 進度（2026-11-06）

已決定：複雜公式「顯示但不用打」（游標自動跳過、不計分）；PDF 頁面截圖在瀏覽器用 pdf.js 做。

**階段 1 完成**（實際做法與下面原計畫略有不同）：

- `arxiv_import.py` 重寫解析器：`/pdf/` 網址可用；保留 Figure/Section 參照文字、拿掉 `[25]` 引用；數字類公式變成可打的文字（`3.6x`、`$3.85`、`1M`）；
  其餘公式（含獨立方程式）在文字裡是一個私用區字元 `U+E000+n`，`lesson.formulas[n] = { tex, display, tree }`（tree 是白名單 MathML 的 JSON）。
- 圖表放在教材層級 `lesson.figures = [{ label, kind, images, caption, rows?, anchor, where }]`，圖片直接連 arxiv.org（只允許 `https://arxiv.org/html/…` 圖檔）。
- 打字引擎（`sentences.mjs`）：公式字元、以及只有公式的整句連同後面的換行，游標自動帶過且不計分；退格會一起退掉公式。
- 閱讀器：句子裡用 MathML 畫公式；下方「圖表面板」顯示目前句子提到的圖，或段落位置之前最近的一張；表格以文字表格顯示。
- 練習冊匯出／匯入與公開分享都帶上 formulas、figures（匯入時重新驗證）。
- 測試：`test/test_arxiv.py`（新增 2 個）、`test/paper.test.mjs`（7 個）、手動瀏覽器檢查 `node test/paper-browser.mjs`（需連 arxiv.org）。
- 還沒做：原計畫第 5 點「本章圖表」縮圖列、點圖放大（現在點圖是開新分頁看原圖）。

**階段 2 完成**（做法改成「存原始 PDF、需要時才畫頁面」，比預先截好每頁省空間）：

- 伺服器 `pdf_to_text`：每頁一個章節（`p. N`，帶 `page`），並去掉每頁重複的頁首／頁尾與頁碼。
- 上傳 PDF 時，原始檔以 Blob 存進 IndexedDB（`lingtype-data` 的 `pdf:<教材 id>`）；`lesson.figures` 每頁一筆 `{ kind:'page', page, anchor }`。
- 圖表面板顯示到某頁時，才用 pdf.js 4.10.38（cdnjs，第一次需要網路）畫成圖片；最近 24 頁留在記憶體。
- 刪除教材會一併刪掉存著的 PDF；練習冊分享與備份不含 PDF 頁面（換電腦還原後面板會說找不到原始 PDF）。
- 測試：`test/test_importers.py`（分頁、頁首頁尾）、`test/paper.test.mjs`（頁面對應、分享不帶頁面）；
  瀏覽器檢查 `LINGTYPE_PDF=<pdf 路徑> node test/paper-browser.mjs`。

**圖表列與放大完成**：面板上方「本章圖表」列出目前文字裡的所有圖表（有縮圖），點一下就顯示那張，直到打到下一張圖的位置才自動換回；點圖片會放大顯示（Esc 或「關閉」回到打字，Esc 不會結束練習）。

**之後可做**：跨頁的句子會被切成兩半、掃描型 PDF 的 OCR。

## 現況（2026-11-06 檢查）

- `arxiv_import.py` 已能匯入 arXiv HTML 的章節，但 **整個略過 `<figure>`、`<math>`、`<table>`**。
- 只接受 `arxiv.org/abs/…` 和 `arxiv.org/html/…`；貼 `arxiv.org/pdf/2611.05306` 會直接報錯。
- `<math>` 被丟掉會吃掉數字：2611.05306 有 146 個 `<math>`，很多只是 `$3.85`、`256`、`3.6×`，匯入後句子變成「costs  per query」。**這是現在就有的 bug。**
- PDF 匯入（`importers.py: pdf_to_text`）只取純文字，不分頁、沒有圖。
- 閱讀器（`app.mjs: paintArticle`）一次只顯示目前這一句，旁邊有空間放圖。
- 實測 2611.05306 的 HTML：25 個 `<figure>`（含 `ltx_table`），圖片是相對路徑 `2611.05306v1/figures/xxx.png`，可直接從 arxiv.org 讀取，`<figcaption>` 內有「Figure N:」編號。

## 資料格式（向下相容）

章節維持 `{ title, text }`，多一個可選欄位：

```js
section.figures = [
  { id:'S1.F2', label:'Figure 2', kind:'image' | 'table' | 'page',
    src:'https://arxiv.org/html/2611.05306v1/figures/…png' | 'asset:<key>',
    caption:'…', afterParagraph: 3 }
]
```

- `text` 不變，打字引擎完全不用改。
- `asset:<key>` 指向 IndexedDB 裡存的圖片 Blob（PDF 頁面用）。

## 階段 1：arXiv HTML 帶圖（先做，最划算）

1. `canonical_url` 接受 `/pdf/<id>`（含 `.pdf` 尾碼、版本號），一律轉成 HTML 版。
2. `ArticleParser` 收集 `<figure class="ltx_figure">`：第一個 `<img>` 的 `src`（以 HTML 網址解析成絕對網址，只允許 `arxiv.org` 主機）、`<figcaption>` 文字、所在章節與「在第幾段之後」。
3. `<math>` 改用 `alttext`：純數字／簡單符號（`3.6\times` → `3.6×`、`\$3.85` → `$3.85`、單一變數）放進文字；複雜公式先放 `[公式]` 之類的佔位，或整句標記不需打字（見階段 3）。
4. 閱讀器加「圖表面板」：
   - 目前句子提到 `Figure N` / `Fig. N` / `Table N` → 顯示那張圖；
   - 否則顯示本段之前最近的一張圖；
   - 點圖放大（lightbox），面板可收合；手機版放在翻譯下方。
5. 章節選單旁加「本章圖表」縮圖列，可跳到該圖附近的段落。
6. 測試：`test/test_arxiv.py` 用存下來的小 HTML 片段測圖片抽取、相對網址、數字公式、`/pdf/` 網址轉換。

圖片先直接連 arxiv.org（不複製、不進 repo，符合現在 `arxiv_import.py` 的原則）；離線快取放到階段 2。

## 階段 2：上傳 PDF 帶頁面圖片

論文的圖多半是向量圖，抽「嵌入的點陣圖」常常抽不到，所以以 **整頁截圖** 為主：

1. 前端用 pdf.js（從 cdnjs 載入固定版本）把每頁畫成 JPEG（寬約 1200px），存進 IndexedDB 新的 `assets` object store（`storage.mjs` 加 `readAsset / writeAsset`，版本升到 2）。
2. 文字仍由伺服器 `pdf_to_text` 抽，但改成 **一頁一個章節**（`Page 1`、`Page 2`…），每章的 `figures` 放該頁截圖 → 打第 1 頁的文字時，面板就是第 1 頁原貌（圖、表、公式都看得到）。
3. 可選：pypdf `page.images` 抽出的點陣圖也列入該頁 figures。
4. arXiv 沒有 HTML 版的舊論文：伺服器改抓 `arxiv.org/pdf/<id>`，交給同一條 PDF 流程。
5. 刪除教材時一併刪掉它的 assets；備份（`backup.mjs`）預設不含圖片，避免檔案過大。
6. 掃描型 PDF（沒有文字層）仍需 OCR（「下一步」第 9 項），不在這次範圍。

## 階段 3：之後再考慮

- 打字引擎支援「不需打的片段」，讓複雜公式顯示成真的公式（MathML 直接顯示 `<math>`）但游標自動跳過。
- `ltx_table` 轉成乾淨的 HTML 表格顯示（只留 table/tr/td/th 與文字）。
- arXiv 圖片快取到 IndexedDB，離線也看得到。
- 單字本記下單字出現的論文與圖號。
- 公開練習冊（社群庫）只附原文連結，不上傳圖片。

## 待決定

- 複雜公式在階段 1 的處理：佔位字（要打）還是整句跳過？建議先佔位，階段 3 再做跳過。
- PDF 頁面截圖在前端（pdf.js，不用新增 Python 套件）還是後端（PyMuPDF，AGPL 授權、套件大）？建議前端。
