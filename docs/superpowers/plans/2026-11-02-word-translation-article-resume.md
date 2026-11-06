# 單字翻譯與文章續練實作計畫

**Goal:** 選字後取得譯文並在失敗時提供重試；每篇文章恢復自己的練習位置。

**Architecture:** 沿用現有翻譯 API 和練習快照，為文章記住最後使用的範圍，並讓失敗的單字翻譯可見且可重試。

**Tech Stack:** JavaScript ES modules、Node test runner、Python。

**Spec:** `docs/superpowers/specs/2026-11-02-word-translation-article-resume-design.md`

## 工作

1. 追查翻譯請求，補上失敗與重試的測試，修正已確認的問題並顯示狀態。
2. 補上切換文章、切換章節與重新載入的進度測試，實作每篇文章的最後文章練習設定，保持舊資料相容。
3. 執行相關測試及完整測試，檢查差異並回報限制。
