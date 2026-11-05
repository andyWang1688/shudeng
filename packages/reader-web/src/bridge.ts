import { isReaderMessage, type HostToReader, type ReaderToHost } from './protocol'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
    __readerMessages?: ReaderToHost[]
    __readerReady?: boolean
  }
}

/**
 * 与 React Native WebView / 原生壳的消息桥：
 * - 原生 → Web：window.postMessage({type:'reader:*'}) 或 injectJavaScript 直接调用 window.__readerHost
 * - Web → 原生：优先 window.ReactNativeWebView.postMessage(JSON)，否则 postMessage 给 parent/opener
 */
class ReaderBridge {
  readonly messages: ReaderToHost[] = []
  private handlers = new Set<(message: HostToReader) => void>()

  constructor() {
    window.__readerMessages = this.messages
    window.addEventListener('message', (event) => {
      // Web's parent iframe host is trusted; publication child frames are not.
      // Native commands call __readerHost directly and never need child messages.
      if (event.source !== window && !(window.parent !== window && event.source === window.parent)) return
      if (!isReaderMessage(event.data)) return
      this.dispatch(event.data)
    })
  }

  onMessage(handler: (message: HostToReader) => void): void {
    this.handlers.add(handler)
  }

  dispatch(message: HostToReader): void {
    for (const handler of this.handlers) handler(message)
  }

  send(message: ReaderToHost): void {
    this.messages.push(message)
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500)
    const json = JSON.stringify(message)
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(json)
      return
    }
    window.parent?.postMessage(message, '*')
  }

  error(message: string): void {
    this.send({ type: 'reader:error', payload: { message } })
  }
}

export const bridge = new ReaderBridge()

// 原生壳可直接调用：window.__readerHost({type:'reader:open', ...})
declare global {
  interface Window {
    __readerHost?: (message: HostToReader) => void
  }
}
window.__readerHost = (message: HostToReader) => bridge.dispatch(message)
