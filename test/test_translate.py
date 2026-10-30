import io
import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import translate
from translate import translate_sentences, mymemory_translate


def fake_googletrans(transform):
    class FakeTranslator:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def translate(self, sentences, src, dest):
            return [SimpleNamespace(text=transform(sentence)) for sentence in sentences]
    return patch.dict(sys.modules, {'googletrans': SimpleNamespace(Translator=FakeTranslator)})


def no_fallback(sentences, language):
    raise AssertionError('fallback should not run')


class TranslateTests(unittest.TestCase):
    def setUp(self):
        translate._google_paused_until = 0.0

    def test_uses_googletrans_without_api_key_and_preserves_order(self):
        with fake_googletrans(lambda sentence: '譯文 ' + sentence):
            self.assertEqual(translate_sentences(['Hello.', 'World.'], 'zh', fallback=no_fallback), ['譯文 Hello.', '譯文 World.'])

    def test_untranslated_echo_uses_the_fallback(self):
        with fake_googletrans(lambda sentence: sentence):
            self.assertEqual(translate_sentences(['Library.'], 'zh', fallback=lambda s, l: ['圖書館。']), ['圖書館。'])

    def test_partial_google_response_retries_only_missing_sentences(self):
        calls = []
        def fallback(sentences, language):
            calls.append(sentences)
            return ['世界。']
        with fake_googletrans(lambda sentence: '你好。' if sentence == 'Hello.' else sentence):
            self.assertEqual(translate_sentences(['Hello.', 'World.'], 'zh', fallback=fallback), ['你好。', '世界。'])
        self.assertEqual(calls, [['World.']])

    def test_echo_with_failing_fallback_is_reported_as_a_failure(self):
        def broken(sentences, language): raise OSError('offline')
        with fake_googletrans(lambda sentence: sentence):
            with self.assertRaises(RuntimeError): translate_sentences(['Boats returned before dusk.'], 'ja', fallback=broken)
        with fake_googletrans(lambda sentence: sentence):
            with self.assertRaises(RuntimeError): translate_sentences(['Boats returned before dusk.'], 'ja', fallback=lambda s, l: list(s))

    def test_google_is_skipped_for_a_while_after_it_refuses(self):
        calls = []
        def fallback(sentences, language): calls.append(sentences); return ['圖書館']
        with fake_googletrans(lambda sentence: sentence):
            translate_sentences(['library'], 'zh', fallback=fallback)
        with fake_googletrans(lambda sentence: '不該使用'):
            self.assertEqual(translate_sentences(['library'], 'zh', fallback=fallback), ['圖書館'])
        self.assertEqual(len(calls), 2)

    def test_mymemory_reads_translations_and_reports_quota(self):
        requests = []
        def opener(payload):
            def open_(request, timeout):
                requests.append(request.full_url)
                return io.BytesIO(json.dumps(payload).encode())
            return open_
        self.assertEqual(mymemory_translate(['library'], 'ko', opener=opener({'responseData': {'translatedText': '도서관'}})), ['도서관'])
        self.assertIn('langpair=en%7Cko', requests[0])
        self.assertEqual(mymemory_translate(['x' * 501], 'ja', opener=opener({})), [''])
        with self.assertRaises(RuntimeError):
            mymemory_translate(['library'], 'ja', opener=opener({'quotaFinished': True, 'responseData': {'translatedText': ''}}))

    def test_rejects_unknown_language_and_empty_input(self):
        with self.assertRaises(ValueError): translate_sentences(['Hello'], 'zz')
        with self.assertRaises(ValueError): translate_sentences([], 'zh')

if __name__ == '__main__':
    unittest.main()
