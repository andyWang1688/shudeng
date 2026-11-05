Pod::Spec.new do |s|
  s.name = 'ShudengEpub'
  s.version = '1.0.0'
  s.summary = 'WebKit EPUB presentation and UIKit page curl'
  s.description = s.summary
  s.license = { :type => 'Private' }
  s.author = 'Shudeng'
  s.homepage = 'https://github.com/andyWang1688/shudeng'
  s.source = { :git => 'https://github.com/andyWang1688/shudeng.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ReadiumZIPFoundation', '3.0.1'
  s.frameworks = 'WebKit', 'UIKit'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'ShudengEpubNotices' => ['ReadiumZIPFoundation-LICENSE.txt'] }
end
