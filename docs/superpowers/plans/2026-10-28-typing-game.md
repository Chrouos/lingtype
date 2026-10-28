# 英文打字學習遊戲 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** 建立可離線使用靜態教材的英文單字與文章打字遊戲。
**Architecture:** 靜態 HTML、CSS 與 ES modules；教材、純打字邏輯及畫面互動分離。無後端與外部依賴。
**Tech Stack:** HTML、CSS、JavaScript、Node.js built-in test runner。
**Spec:** docs/superpowers/specs/2026-10-28-typing-language-learning-design.md

## Global Constraints

英文輸入；繁中、日文、韓文翻譯；教材手選單字；文章保留原文；無外部翻譯、帳號或上傳。

## Review Focus

- 單字首字及中途錯誤均重置，錯誤計數累積。
- 單字結束後不能繼續推進，計時不受錯誤重置影響。
- 文章錯誤可修正，最終正確率與 WPM 以最後輸入計算。
- 零耗時不產生無限或無效速度。
- 切換教材、模式、語言與重玩時不沿用舊進度。

### Task 1: 教材與打字引擎

**Files:** `site/data.js`, `site/typing.js`, `test/typing.test.mjs`

- [ ] 撰寫單字錯誤重置、完成、文章修正及結果計算測試。
- [ ] 執行 `node --test test/typing.test.mjs`，確認初始失敗。
- [ ] 實作純函式及原創教材，各篇含三語文章及重點單字翻譯。
- [ ] 執行測試並確認通過。

### Task 2: 遊戲畫面與互動

**Files:** `site/index.html`, `site/style.css`, `site/app.js`

- [ ] 實作教材選擇、翻譯切換、單字／文章輸入、進度與結果畫面，支援鍵盤與行動版。
- [ ] 驗證切換與重玩會重置狀態；完成單字後可進入同篇文章。
- [ ] 執行引擎測試、JavaScript 語法檢查與可用的瀏覽器驗證。

### Task 3: 打包與交付

- [ ] 確認靜態網站能提供所有資源，並依 Sites 工具提供的能力處理預覽或發布。
- [ ] 回報驗證結果和未完成項目。
