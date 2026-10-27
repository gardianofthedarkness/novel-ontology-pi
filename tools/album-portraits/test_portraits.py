import importlib.util
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("portraits", Path(__file__).with_name("portraits.py"))
portraits = importlib.util.module_from_spec(spec)
spec.loader.exec_module(portraits)


class PortraitTests(unittest.TestCase):
    def test_cropper_main_preserves_assignments_on_repeat_with_test_detectors(self):
        class TestImage:
            size = (100, 100)

            def convert(self, mode):
                return self

            def crop(self, box):
                return self

            def save(self, path):
                Path(path).write_bytes(b"unit-test-crop")

        class TestOCR:
            def __call__(self, path):
                return [[[[10, 42], [30, 42], [30, 48], [10, 48]], "御坂美琴", 0.99]], None

        class TestOpenCC:
            def __init__(self, conversion):
                pass

            def convert(self, text):
                return text

        modules = {name: types.ModuleType(name) for name in ["rapidocr_onnxruntime", "imgutils", "imgutils.detect", "opencc", "PIL"]}
        modules["rapidocr_onnxruntime"].RapidOCR = TestOCR
        modules["imgutils.detect"].detect_heads = lambda image: [([10, 10, 30, 30], "head", 0.99)]
        modules["opencc"].OpenCC = TestOpenCC
        modules["PIL"].Image = types.SimpleNamespace(open=lambda path: TestImage())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ontology").mkdir()
            (root / "assets").mkdir()
            (root / "assets/plate.png").write_bytes(b"unit-test-source")
            (root / "ontology/illustrations.jsonl").write_text(json.dumps({"id": "ill_1", "kind": "plate", "asset": "assets/plate.png"}) + "\n")
            (root / "ontology/entities.jsonl").write_text(json.dumps({"id": "char_a", "kind": "Character", "names": [{"text": "御坂美琴"}]}) + "\n")
            with patch.dict(sys.modules, modules), patch.object(sys, "argv", ["portraits.py", str(root)]), patch.object(portraits.importlib.util, "find_spec", return_value=object()):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(portraits.main(), 0)
                self.assertEqual(json.loads(output.getvalue())["created"], 1)
                before = (root / "ontology/portraits.jsonl").read_text()
                record = json.loads(before)
                self.assertEqual(record["entityId"], "char_a")
                self.assertEqual(record["matchKind"], "exact-line")
                self.assertTrue((root / record["portrait"]).is_file())
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(portraits.main(), 0)
                self.assertEqual((root / "ontology/portraits.jsonl").read_text(), before)
                self.assertEqual(len(list((root / "assets/portraits").iterdir())), 1)

    def test_caption_requires_unique_whole_name_not_mentions(self):
        variants = [{"御坂美琴"}, {"食蜂操祈"}]
        mention = {"norms": {"不喜欢御坂美琴"}, "conf": 0.99}
        self.assertIsNone(portraits.unique_anchor(variants, [mention], 0))
        caption = {"norms": {"御坂美琴"}, "conf": 0.99}
        self.assertIsNotNone(portraits.unique_anchor(variants, [caption], 0))
        self.assertIsNone(portraits.unique_anchor([variants[0], variants[0]], [caption], 0))

    def test_close_heads_and_already_claimed_faces_stay_unassigned(self):
        heads = [{"cx": 20, "cy": 20}, {"cx": 80, "cy": 20}]
        self.assertEqual(portraits.nearest_head(heads, set(), {"cx": 20, "cy": 30}, 100, 100), 0)
        self.assertIsNone(portraits.nearest_head(heads, set(), {"cx": 50, "cy": 30}, 100, 100))
        self.assertIsNone(portraits.nearest_head(heads, {0}, {"cx": 20, "cy": 30}, 100, 100))
        self.assertIsNone(portraits.nearest_head(heads, set(), {"cx": 20, "cy": 95}, 100, 100))

    def test_latest_canonical_forms_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "ontology").mkdir()
            entities = [{"id": "char_a", "kind": "Character", "names": [{"text": "old"}]},
                        {"id": "char_a", "kind": "Character", "names": [{"text": "御坂美琴"}]},
                        {"id": "place_a", "kind": "Location", "names": [{"text": "御坂美琴"}]}]
            (root / "ontology/entities.jsonl").write_text("\n".join(json.dumps(entity) for entity in entities))
            self.assertEqual(portraits.load_names(root, None), [{"entityId": "char_a", "name": "御坂美琴", "forms": ["御坂美琴"]}])

    def test_asset_escape_symlinks_and_atomic_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            self.assertEqual(portraits.safe_path(root, "assets/head.png", "assets"), root.resolve() / "assets/head.png")
            with self.assertRaises(ValueError):
                portraits.safe_path(root, "assets/../outside", "assets")
            (root / "assets/link").symlink_to(root)
            with self.assertRaises(ValueError):
                portraits.safe_path(root, "assets/link/outside", "assets")
            path = root / "metadata.jsonl"
            portraits.atomic_records(path, [{"name": "御坂美琴"}])
            self.assertEqual(json.loads(path.read_text()), {"name": "御坂美琴"})
            link = root / "metadata-link"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                portraits.atomic_records(link, [])
            self.assertTrue(path.read_text())


if __name__ == "__main__":
    unittest.main()
