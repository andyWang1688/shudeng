# Original sample with an intentional scripted programmatic-navigation fault.
require 'tmpdir'
require 'fileutils'
base = File.expand_path('../ios/ShudengTests/Fixtures', __dir__)
destination = File.join(base, 'curl-failure.epub')
Dir.mktmpdir('shudeng-curl-failure') do |dir|
  system('unzip', '-q', File.join(base, 'original-fixture.epub'), '-d', dir, exception: true)
  path = File.join(dir, 'OEBPS/ch1.xhtml')
  text = File.read(path).sub('</head>', <<~XML)
    <script type="text/javascript">window.addEventListener('load', function () { window.scrollBy = function () {}; });</script>
    </head>
  XML
  File.write(path, text)
  package = File.join(dir, 'OEBPS/book.opf')
  File.write(package, File.read(package).sub('href="ch1.xhtml"', 'href="ch1.xhtml" properties="scripted"'))
  Dir.glob(File.join(dir, '**/*')).each { |file| File.utime(Time.utc(2026, 1, 1), Time.utc(2026, 1, 1), file) }
  FileUtils.rm_f(destination)
  Dir.chdir(dir) do
    system('zip', '-q', '-X', '-0', destination, 'mimetype', exception: true)
    system('zip', '-q', '-X', '-r', destination, 'META-INF', 'OEBPS', exception: true)
  end
end
