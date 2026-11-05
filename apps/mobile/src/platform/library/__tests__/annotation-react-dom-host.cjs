// Only the DOM host is simulated. React, ReactDOM and the reader hook are real.
class Node {
  constructor(type, name, doc) { this.nodeType = type; this.nodeName = name; this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node; }
  insertBefore(node, ref) { if (node.parentNode) node.parentNode.removeChild(node); this.childNodes.splice(this.childNodes.indexOf(ref), 0, node); node.parentNode = this; return node; }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node; }
  addEventListener() {}
  removeEventListener() {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { if (this.nodeType === 3) this.nodeValue = String(value); else { for (const node of this.childNodes) node.parentNode = null; this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value))); } }
}
class Element extends Node {
  constructor(tag, doc) { super(1, tag.toUpperCase(), doc); this.tagName = this.nodeName; this.localName = tag; this.namespaceURI = 'http://www.w3.org/1999/xhtml'; this.attributes = {}; this.style = { setProperty() {}, removeProperty() {} }; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
}
function installDOM() {
  const document = new Node(9, '#document', null); document.ownerDocument = document;
  document.createElement = tag => new Element(tag, document);
  document.createElementNS = (_, tag) => document.createElement(tag);
  document.createTextNode = text => { const node = new Node(3, '#text', document); node.nodeValue = text; return node; };
  document.documentElement = document.createElement('html'); document.body = document.createElement('body'); document.documentElement.appendChild(document.body); document.activeElement = document.body;
  const window = { document, HTMLElement: Element, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {}, get event() { return undefined; } }; document.defaultView = window;
  global.window = window; global.document = document; global.HTMLElement = Element; global.IS_REACT_ACT_ENVIRONMENT = true;
  return document;
}
module.exports = { installDOM };
