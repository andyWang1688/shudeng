# Original Shudeng validation book; no external book content.
require 'fileutils'
require 'tmpdir'
base = File.expand_path('../ios/ShudengTests/Fixtures', __dir__)
%w[fixed-layout missing-chapter].each { |name| FileUtils.rm_f(File.join(base, name + '.epub')) }
Dir.mktmpdir('shudeng-fixture') do |dir|
  system('unzip', '-q', File.join(base, 'original-fixture.epub'), '-d', dir, exception: true)
  opf = File.join(dir, 'OEBPS/book.opf')
  original = File.read(opf)
  File.write(opf, original.sub('>reflowable</meta>', '>pre-paginated</meta>'))
  Dir.chdir(dir) { system('zip', '-q', '-0', File.join(base, 'fixed-layout.epub'), 'mimetype', exception: true); system('zip', '-q', '-r', File.join(base, 'fixed-layout.epub'), 'META-INF', 'OEBPS', exception: true) }
  File.write(opf, original)
  FileUtils.rm(File.join(dir, 'OEBPS/ch2.xhtml'))
  Dir.chdir(dir) { system('zip', '-q', '-0', File.join(base, 'missing-chapter.epub'), 'mimetype', exception: true); system('zip', '-q', '-r', File.join(base, 'missing-chapter.epub'), 'META-INF', 'OEBPS', exception: true) }
end
File.write(File.join(base, 'corrupted.epub'), 'not an EPUB archive')
File.write(File.join(base, 'unsupported.txt'), 'Unsupported file format')
