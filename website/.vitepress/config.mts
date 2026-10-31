import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: '书灯',
  description: '以阅读为中心、AI 按需辅助的 iOS 阅读应用',
  base: process.env.VITEPRESS_BASE || (process.env.GITHUB_ACTIONS ? '/shudeng/' : '/'),
  srcDir: './doc',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '使用文档', link: '/quick-start' },
      { text: 'GitHub', link: 'https://github.com/andyWang1688/shudeng' }
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '快速开始', link: '/quick-start' },
          { text: '为什么做书灯', link: '/why-shudeng' }
        ]
      },
      {
        text: '功能',
        items: [
          { text: '阅读', link: '/reading' },
          { text: '标注与笔记', link: '/annotations' },
          { text: '阅读问答', link: '/reading-qa' },
          { text: '阅读问答是怎么工作的', link: '/how-reading-ai-works' },
          { text: 'AI 服务', link: '/ai-service' }
        ]
      },
      {
        text: '参考',
        items: [
          { text: '隐私与数据', link: '/privacy' },
          { text: '常见问题', link: '/faq' }
        ]
      }
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最近更新',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/andyWang1688/shudeng' }
    ],
    footer: {
      message: '阅读是主角，AI 按需出现。',
      copyright: '书灯 Shudeng'
    },
    editLink: {
      pattern: 'https://github.com/andyWang1688/shudeng/edit/main/website/doc/:path',
      text: '在 GitHub 上编辑此页'
    }
  }
})
