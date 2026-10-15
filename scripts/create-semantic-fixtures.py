"""Package the predeclared original corpus as reproducible, importable EPUBs."""
import hashlib
import html
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
source = root / 'ios/ShudengTests/Fixtures/semantic-source.json'
data = json.loads(source.read_text())
base = root / 'ios/ShudengTests/Fixtures'
mapping = {}
for name, rows in [
    ('semantic-fixture', [r for r in data['rows'] if r['book'] == 'saltbridge']),
    ('semantic-english', [r for r in data['rows'] if r['id'] == 'ch3-p2' or r['href'] == 'appendix.xhtml']),
    ('semantic-other', [r for r in data['rows'] if r['book'] == 'unrelated']),
]:
    chapters = list(dict.fromkeys(r['href'] for r in rows))
    files = {'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'}
    manifest = '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' + ''.join(f'<item id="c{i}" href="{c}" media-type="application/xhtml+xml"/>' for i, c in enumerate(chapters))
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))
    files['OEBPS/book.opf'] = f'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">{name}</dc:identifier><dc:title>{name}</dc:title><dc:language>zh</dc:language><dc:creator>Shudeng original fixture</dc:creator><meta property="dcterms:modified">2026-10-16T00:00:00Z</meta></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>'
    links = ''.join(f'<li><a href="{c}">{html.escape(next(r["chapter"] for r in rows if r["href"] == c))}</a></li>' for c in chapters)
    files['OEBPS/nav.xhtml'] = f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>{links}</ol></nav></body></html>'
    for c in chapters:
        prose = ''.join(f'<p id="{r["id"]}">{html.escape(r["text"])}</p>' for r in rows if r['href'] == c)
        files['OEBPS/' + c] = f'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Original semantic fixture</title></head><body>{prose}</body></html>'
    output = base / (name + '.epub')
    with zipfile.ZipFile(output, 'w') as archive:
        for key, value in [('mimetype', 'application/epub+zip')] + sorted(files.items()):
            info = zipfile.ZipInfo(key, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED if key == 'mimetype' else zipfile.ZIP_DEFLATED
            archive.writestr(info, value)
    mapping[name] = {'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'source_fixture_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'license': 'Original Shudeng test prose, authorized for use and redistribution', 'records': [{**r, 'href': 'OEBPS/' + r['href'], 'selector': '#' + r['id']} for r in rows]}
(base / 'semantic-map.json').write_text(json.dumps(mapping, ensure_ascii=False, indent=2))
(base / 'semantic-cases.json').write_text(json.dumps(data['cases'], ensure_ascii=False, indent=2))
print(json.dumps({k: {'sha256': v['sha256'], 'records': len(v['records'])} for k, v in mapping.items()}, indent=2))
