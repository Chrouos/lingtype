import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from PIL import Image

from public_library import PublicLibrary


def workbook():
    return {'format':'lingtype-workbook', 'version':1, 'lesson':{'title':'A story', 'text':'Hello world.', 'words':[], 'translations':{}}}


class CommunityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'library.db'
        self.library = PublicLibrary(self.path)
        self.book, self.owner = self.library.publish(workbook())

    def test_likes_are_idempotent_and_persist(self):
        self.assertEqual(self.library.set_like(self.book, 'a' * 32, True), 1)
        self.assertEqual(self.library.set_like(self.book, 'a' * 32, True), 1)
        self.assertEqual(self.library.set_like(self.book, 'b' * 32, True), 2)
        self.assertEqual(PublicLibrary(self.path).community(self.book, 'a' * 32)['likes'], 2)
        self.assertTrue(self.library.community(self.book, 'a' * 32)['liked'])
        self.assertEqual(self.library.set_like(self.book, 'a' * 32, False), 1)

    def test_comments_validate_and_owner_can_remove(self):
        comment = self.library.add_comment(self.book, '讀者', '<hello>')
        self.assertEqual(self.library.community(self.book)['comments'][0]['text'], '<hello>')
        self.assertFalse(self.library.remove_comment(self.book, comment, 'wrong'))
        self.assertTrue(self.library.remove_comment(self.book, comment, self.owner))
        with self.assertRaises(ValueError): self.library.add_comment(self.book, '', ' ')
        with self.assertRaises(ValueError): self.library.add_comment(self.book, '', 'x' * 1001)

    def test_missing_book_and_invalid_visitor_rejected(self):
        with self.assertRaises(ValueError): self.library.set_like('f' * 32, 'a' * 32, True)
        with self.assertRaises(ValueError): self.library.set_like(self.book, 'invalid', True)

    def test_completed_attempts_are_counted_and_ranked(self):
        self.library.record_attempt(self.book, 'Reader', 42.5, 95)
        self.library.record_attempt(self.book, '', 55, 100)
        info = PublicLibrary(self.path).community(self.book)
        self.assertEqual(info['practiceCount'], 2)
        self.assertEqual(info['ranking'][0]['wpm'], 55)
        self.assertEqual(info['ranking'][0]['author'], '匿名讀者')
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, '', -1, 100)
        with self.assertRaises(ValueError): self.library.record_attempt(self.book, '', 10, 101)

    def test_cover_validates_image_and_owner(self):
        image = BytesIO()
        Image.new('RGB', (3, 4), 'red').save(image, 'PNG')
        with self.assertRaises(ValueError): self.library.set_cover(self.book, self.owner, b'not an image')
        self.assertFalse(self.library.set_cover(self.book, 'wrong', image.getvalue()))
        self.assertTrue(self.library.set_cover(self.book, self.owner, image.getvalue()))
        content_type, content = PublicLibrary(self.path).get_cover(self.book)
        self.assertEqual(content_type, 'image/png')
        self.assertEqual(content, image.getvalue())

if __name__ == '__main__': unittest.main()
