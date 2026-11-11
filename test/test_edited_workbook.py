import tempfile
import unittest
from pathlib import Path
from public_library import PublicLibrary


class EditedWorkbookTests(unittest.TestCase):
    def test_publication_preserves_edited_marker_and_attribution(self):
        workbook = {'format':'lingtype-workbook', 'version':1, 'lesson':{
            'title':'Edited', 'text':'Edited text.', 'words':[], 'translations':{},
            'category':'custom', 'edited':True, 'sourceUrl':'https://example.org/article',
            'authors':['A. Writer'], 'source':'Original article', 'license':'CC BY'}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'library.db'
            identifier, _ = PublicLibrary(path).publish(workbook)
            self.assertEqual(PublicLibrary(path).get(identifier), workbook)


if __name__ == '__main__':
    unittest.main()
