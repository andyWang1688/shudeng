Pod::Spec.new do |s|
  s.name = 'ShudengChatBackground'
  s.version = '1.0.0'
  s.summary = 'Bounded background time for book chat on iOS'
  s.description = s.summary
  s.license = { :type => 'Private' }
  s.author = 'Shudeng'
  s.homepage = 'https://github.com/andyWang1688/shudeng'
  s.source = { :git => 'https://github.com/andyWang1688/shudeng.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'
  s.source_files = '**/*.swift'
end
