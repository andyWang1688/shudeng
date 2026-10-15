# Original legal EPUBs for literal search, occurrence identity and interrupted preparation.
require 'tmpdir'
require 'fileutils'
base = File.expand_path('../ios/ShudengTests/Fixtures', __dir__)
%w[search-fixture search-other search-long].each do |name|
  Dir.mktmpdir('shudeng-search') do |dir|
    system('unzip', '-q', File.join(base, 'original-fixture.epub'), '-d', dir, exception: true)
    count = name == 'search-long' ? 40 : 2
    File.write(File.join(dir, 'OEBPS/book.opf'), <<~XML)
      <?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">original-#{name}</dc:identifier><dc:title>#{name}</dc:title><dc:language>zh</dc:language><dc:creator>Shudeng original fixture</dc:creator><meta property="dcterms:modified">2026-10-15T00:00:00Z</meta></metadata><manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      #{(1..count).map { |n| %(<item id="c#{n}" href="ch#{n}.xhtml" media-type="application/xhtml+xml"/>) }.join}
      </manifest><spine>#{(1..count).map { |n| %(<itemref idref="c#{n}"/>) }.join}</spine></package>
    XML
    File.write(File.join(dir, 'OEBPS/nav.xhtml'), %(<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>#{(1..count).map { |n| %(<li><a href="ch#{n}.xhtml">搜索第#{n}章</a></li>) }.join}</ol></nav></body></html>))
    (1..count).each do |n|
      content = if name == 'search-long'
        (1..500).map { |p| %(<p id="p#{p}"><strong>L#{n}-P#{p}</strong> #{('原创长书资料准备验证。Committed chapters survive interruptions. ' * 6)}本章#{n}本段#{p}。</p>) }.join
      elsif name == 'search-other'
        '<p>OTHER-ONLY 原创另一本书；本句只能在另一本书找到。</p>'
      elsif n == 1
        %(<p id="repeat"><strong>S1-FIRST</strong> 重复句出现位置。The same sentence. #{'原文应按真实字符定位，不能只回到段首。' * 65}<strong>S1-SECOND</strong> 重复句出现位置。The same sentence. 第二处才是目标。</p><p id="inline">S1-INLINE 😀 A&amp;B  <em>跨标签</em>搜索 café。</p><p>可见<span><span hidden="hidden">隐秘标记</span>后续可见</span>正文</p>)
      else
        '<p id="cross"><strong>S2-CROSS</strong> 重复句出现位置。The same sentence. 跨章必须回到第二章。</p>'
      end
      File.write(File.join(dir, "OEBPS/ch#{n}.xhtml"), %(<html xmlns="http://www.w3.org/1999/xhtml" lang="zh"><head><title>搜索第#{n}章</title></head><body><h1>搜索第#{n}章</h1>#{content}</body></html>))
    end
    Dir.glob(File.join(dir, '**/*')).each { |path| File.utime(Time.utc(2026, 1, 1), Time.utc(2026, 1, 1), path) }
    destination = File.join(base, name + '.epub')
    FileUtils.rm_f(destination)
    Dir.chdir(dir) do
      system('zip', '-q', '-X', '-0', destination, 'mimetype', exception: true)
      system('zip', '-q', '-X', '-r', destination, 'META-INF', 'OEBPS', exception: true)
    end
  end
end
