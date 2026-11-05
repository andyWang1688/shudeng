import type { FoliateView } from './foliate-types';

const documentPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const activeURL = (value: string) => /^(?:javascript|vbscript|data\s*:\s*(?:text\/(?:html|javascript)|application\/(?:xhtml\+xml|javascript)))/i.test(value.replace(/[\u0000-\u0020\u007f]+/g, ''));

/** Make content inert without removing elements, preserving CFI/selector ordinals.
 * The shell needs scripts for Foliate and WebKit selection events; publications do not. */
export function securePublicationDocument(doc: Document): Document {
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    const name = element.localName.toLowerCase();
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.localName.toLowerCase();
      if (key.startsWith('on') || key === 'srcdoc' || (['href', 'src', 'action', 'formaction', 'data'].includes(key) && activeURL(attribute.value))) element.removeAttributeNode(attribute);
    }
    if (name === 'script') { element.setAttribute('type', 'application/x-shudeng-inert'); element.removeAttribute('src'); element.textContent = ''; }
    if (['animate', 'set', 'animatemotion', 'animatetransform'].includes(name)) {
      const target = element.getAttribute('attributeName')?.toLowerCase() ?? '';
      if (target.startsWith('on') || /^(?:.*:)?(?:href|src|srcdoc|data|type|style|action|formaction)$/.test(target)) element.removeAttribute('attributeName');
    }
    if (name === 'iframe' || name === 'frame' || name === 'embed' || name === 'object') {
      element.removeAttribute('src'); element.removeAttribute('data'); element.removeAttribute('srcdoc');
    }
    if (name === 'base') element.removeAttribute('href');
    if (name === 'meta' && /^(refresh|content-security-policy)$/i.test(element.getAttribute('http-equiv') ?? '')) {
      element.removeAttribute('http-equiv'); element.removeAttribute('content');
    }
  }
  const head = doc.head ?? doc.querySelector('head');
  if (head) {
    const policy = doc.createElementNS(head.namespaceURI, 'meta');
    policy.setAttribute('http-equiv', 'Content-Security-Policy'); policy.setAttribute('content', documentPolicy);
    head.prepend(policy);
  }
  return doc;
}

export function securePublication(book: NonNullable<FoliateView['book']> & { transformTarget?: EventTarget }): void {
  book.transformTarget?.addEventListener('data', event => {
    const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail;
    if (!['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(detail.type)) return;
    const type = detail.type as DOMParserSupportedType;
    detail.data = Promise.resolve(detail.data).then(async value => {
      const source = value instanceof Blob ? await value.text() : String(value);
      const doc = new DOMParser().parseFromString(source, type);
      if (doc.querySelector('parsererror')) throw new Error('书籍章节格式无效，无法安全打开');
      return new XMLSerializer().serializeToString(securePublicationDocument(doc));
    });
  });
  for (const section of book.sections ?? []) {
    const create = section.createDocument?.bind(section);
    if (create) section.createDocument = async () => securePublicationDocument(await create());
  }
}
