"""Translate text with the unofficial, keyless googletrans client, falling back to MyMemory."""
import asyncio
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TARGETS = {'zh': 'zh-tw', 'ja': 'ja', 'ko': 'ko'}
MYMEMORY_TARGETS = {'zh': 'zh-TW', 'ja': 'ja', 'ko': 'ko'}
# After Google refuses, skip it for a while instead of paying its delay on every request.
GOOGLE_PAUSE_SECONDS = 600
_google_paused_until = 0.0
# Every target is written in Han, kana or Hangul; output without any of them was not translated.
TARGET_SCRIPT = re.compile('[぀-ヿ㐀-鿿가-힯豈-﫿]')


def is_translated(results):
    return any(TARGET_SCRIPT.search(text) for text in results)


def google_translate(sentences, language):
    from googletrans import Translator

    async def run():
        results = []
        async with Translator() as translator:
            for offset in range(0, len(sentences), 10):
                chunk = sentences[offset:offset + 10]
                translated = await translator.translate(chunk, src='en', dest=TARGETS[language])
                if len(translated) != len(chunk):
                    raise RuntimeError('翻譯服務回傳的句子數不符。')
                results.extend(unescape(item.text) for item in translated)
        return results

    return asyncio.run(run())


def mymemory_translate(sentences, language, opener=urlopen):
    """Translate one sentence per request with the free, keyless MyMemory API (about 5000 characters a day)."""
    def one(sentence):
        if len(sentence) > 500:
            return ''
        query = urlencode({'q': sentence, 'langpair': f'en|{MYMEMORY_TARGETS[language]}'})
        request = Request(f'https://api.mymemory.translated.net/get?{query}', headers={'User-Agent': 'Lingtype'})
        with opener(request, timeout=15) as response:
            data = json.load(response)
        text = unescape(str((data.get('responseData') or {}).get('translatedText') or ''))
        if data.get('quotaFinished') or 'MYMEMORY WARNING' in text:
            raise RuntimeError('MyMemory 今日免費額度已用完。')
        return text if TARGET_SCRIPT.search(text) else ''
    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, sentences))


def translate_sentences(sentences, language, fallback=mymemory_translate):
    if language not in TARGETS:
        raise ValueError('不支援的翻譯語言。')
    if not isinstance(sentences, list) or not sentences or any(not isinstance(s, str) or not s.strip() for s in sentences):
        raise ValueError('沒有可翻譯的句子。')
    if any(len(s) > 15000 for s in sentences):
        raise ValueError('單句超過 15000 字元，請先分段。')
    # When Google blocks requests, googletrans returns the English source unchanged; try the fallback then.
    global _google_paused_until
    results = [''] * len(sentences)
    if time.monotonic() >= _google_paused_until:
        try:
            google_results = google_translate(sentences, language)
            if len(google_results) == len(sentences):
                results = [value if is_translated([value]) else '' for value in google_results]
                if all(results):
                    return results
        except Exception:
            pass
        if not any(results):
            _google_paused_until = time.monotonic() + GOOGLE_PAUSE_SECONDS
    missing = [i for i, value in enumerate(results) if not value]
    try:
        translated = fallback([sentences[i] for i in missing], language)
        if len(translated) != len(missing):
            raise RuntimeError('翻譯服務回傳的句子數不符。')
        for i, value in zip(missing, translated):
            if is_translated([value]):
                results[i] = value
    except Exception as error:
        if not any(results):
            raise RuntimeError('翻譯服務暫時無法使用，請檢查網路後重試。') from error
    if not any(results):
        raise RuntimeError('翻譯服務沒有回傳譯文，請稍後重試。')
    return results
