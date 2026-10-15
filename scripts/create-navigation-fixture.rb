# Original test book plus deterministic nested, end-of-chapter and invalid TOC targets.
require 'tmpdir'
require 'fileutils'
base = File.expand_path('../ios/ShudengTests/Fixtures', __dir__)
destination = File.join(base, 'navigation-fixture.epub')
Dir.mktmpdir('shudeng-navigation') do |dir|
  system('unzip', '-q', File.join(base, 'original-fixture.epub'), '-d', dir, exception: true)
  File.write(File.join(dir, 'OEBPS/nav.xhtml'), <<~XML)
    <?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>
    <li><a href="ch1.xhtml">第1章</a><ol><li><a href="ch1.xhtml#c1-p30">第1章末</a></li></ol></li>
    <li><a href="ch2.xhtml">第2章</a><ol><li><a href="ch2.xhtml#c2-p30">第2章末</a></li></ol></li>
    <li><a href="ch3.xhtml">第3章</a><ol><li><a href="ch3.xhtml#c3-p30">第3章末</a></li></ol></li>
    <li><a href="ch2.xhtml#missing-anchor">失效锚点</a></li>
    <li><a href="missing.xhtml">失效章节</a></li>
    </ol></nav></body></html>
  XML
  Dir.glob(File.join(dir, '**/*')).each { |path| File.utime(Time.utc(2026, 1, 1), Time.utc(2026, 1, 1), path) }
  FileUtils.rm_f(destination)
  Dir.chdir(dir) do
    system('zip', '-q', '-X', '-0', destination, 'mimetype', exception: true)
    system('zip', '-q', '-X', '-r', destination, 'META-INF', 'OEBPS', exception: true)
  end
end
