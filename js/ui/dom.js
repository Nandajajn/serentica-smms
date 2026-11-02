// Tiny helpers for building page content safely (text is never treated as HTML).
export function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  if (value !== undefined) node.value = value;
  return node;
}
export const $ = (id) => document.getElementById(id);
// Like parent.append(...) but skips null/false, so no stray "null" text appears.
export const put = (parent, ...kids) => parent.append(...kids.flat().filter((k) => k != null && k !== false));
export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '');
export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
