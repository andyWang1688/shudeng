"""Reproduce the fixed local model bundle; run with the project/user virtualenv."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
from urllib.request import urlopen

revision = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
endpoint = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")
base = f"{endpoint}/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/resolve/{revision}"
target = Path(__file__).resolve().parent.parent / "ios/Shudeng/Resources/SemanticModel"
manifest = json.loads((target / "manifest.json").read_text())
with tempfile.TemporaryDirectory() as temporary:
    stage = Path(temporary)
    for remote, name, expected in [
        ("onnx/model_qint8_arm64.onnx", "model.onnx", manifest["uncompressed_model"]["sha256"]),
        ("tokenizer.json", "tokenizer.json", manifest["files"]["tokenizer.json"]["sha256"]),
        ("tokenizer_config.json", "tokenizer_config.json", manifest["upstream_tokenizer_config_sha256"]),
        ("README.md", "MODEL_CARD.md", manifest["files"]["MODEL_CARD.md"]["sha256"]),
    ]:
        with urlopen(f"{base}/{remote}", timeout=120) as response:
            data = response.read()
        assert hashlib.sha256(data).hexdigest() == expected, remote
        (stage / name).write_bytes(data)
    # Canonical gzip header (no name/time, Unix OS); compression level 6.
    compressed = bytearray(gzip.compress((stage / "model.onnx").read_bytes(), compresslevel=6, mtime=0))
    compressed[9] = 3
    (stage / "model.onnx.gz").write_bytes(compressed)
    config = json.loads((stage / "tokenizer_config.json").read_text())
    config["tokenizer_class"] = "XLMRobertaTokenizer"
    (stage / "tokenizer_config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    for name in ["model.onnx.gz", "tokenizer.json", "tokenizer_config.json", "MODEL_CARD.md"]:
        data = (stage / name).read_bytes()
        assert hashlib.sha256(data).hexdigest() == manifest["files"][name]["sha256"], name
        (target / name).write_bytes(data)
print("PASS: fixed model/tokenizer hashes and reproducible bundle")
