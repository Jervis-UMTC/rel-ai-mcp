const SNAPSHOT_DETAILS = new Set(['semantic', 'layout']);

function normalizeBrowserSnapshotDetail(value) {
  const detail = String(value || 'semantic').trim().toLowerCase();
  if (!SNAPSHOT_DETAILS.has(detail)) {
    throw new Error("Browser snapshot detail must be 'semantic' or 'layout'.");
  }
  return detail;
}

const LAYOUT_SNAPSHOT_EXPRESSION = String.raw`(() => {
  const MAX_NODES = 400;
  const MAX_SCANNED_NODES = 5000;
  const MAX_TEXT = 120;
  const IMPORTANT_TAGS = new Set([
    'a', 'article', 'aside', 'button', 'canvas', 'dialog', 'details', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'header', 'img', 'input', 'label', 'main', 'nav', 'option', 'section', 'select', 'summary', 'svg', 'table', 'textarea'
  ]);
  const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'summary', 'textarea']);
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const round = value => Math.round(Number(value) || 0);
  const trimText = value => {
    const text = normalize(value);
    return text.length <= MAX_TEXT ? text : text.slice(0, MAX_TEXT - 1) + '…';
  };
  const directText = element => trimText([...element.childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent || '')
    .join(' '));
  const roleName = element => normalize(element.getAttribute('role'));
  const labelFor = element => trimText(
    element.getAttribute('aria-label') ||
    element.getAttribute('alt') ||
    element.getAttribute('placeholder') ||
    element.getAttribute('title') ||
    directText(element)
  );
  const descriptorFor = element => {
    const tag = element.tagName.toLowerCase();
    const id = normalize(element.id);
    const classNames = [...element.classList].filter(Boolean).slice(0, 2);
    const role = roleName(element);
    const label = labelFor(element);
    let descriptor = tag;
    if (id) descriptor += '#' + id;
    if (classNames.length) descriptor += '.' + classNames.join('.');
    if (role) descriptor += '[role=' + JSON.stringify(role) + ']';
    if (label) descriptor += ' ' + JSON.stringify(label);
    return descriptor;
  };
  const documentElement = document.documentElement;
  const body = document.body;
  const pageWidth = Math.max(documentElement?.scrollWidth || 0, body?.scrollWidth || 0, innerWidth || 0);
  const pageHeight = Math.max(documentElement?.scrollHeight || 0, body?.scrollHeight || 0, innerHeight || 0);
  const lines = [
    'viewport ' + round(innerWidth) + 'x' + round(innerHeight) +
    ' scroll ' + round(scrollX) + ',' + round(scrollY) +
    ' page ' + round(pageWidth) + 'x' + round(pageHeight)
  ];
  if (!body) return lines.join('\n');

  let emitted = 0;
  let scanned = 0;
  const elements = body.querySelectorAll('*');
  for (const element of elements) {
    if (emitted >= MAX_NODES || scanned >= MAX_SCANNED_NODES) break;
    scanned += 1;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity || 1) === 0) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const tag = element.tagName.toLowerCase();
    const role = roleName(element);
    const label = labelFor(element);
    const overflowX = element.scrollWidth > element.clientWidth + 1;
    const overflowY = element.scrollHeight > element.clientHeight + 1;
    const clippedX = overflowX && ['hidden', 'clip'].includes(style.overflowX);
    const clippedY = overflowY && ['hidden', 'clip'].includes(style.overflowY);
    const parent = element.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const outsideParent = Boolean(parentRect && (
      rect.left < parentRect.left - 1 || rect.top < parentRect.top - 1 ||
      rect.right > parentRect.right + 1 || rect.bottom > parentRect.bottom + 1
    ));
    const interactive = INTERACTIVE_TAGS.has(tag) || element.tabIndex >= 0 || Boolean(role);
    const structurallyImportant = IMPORTANT_TAGS.has(tag) || interactive || Boolean(element.id) ||
      element.hasAttribute('data-testid') || Boolean(label) || overflowX || overflowY || outsideParent;
    if (!structurallyImportant) continue;

    const flags = [];
    if (overflowX) flags.push('OVERFLOW_X+' + round(element.scrollWidth - element.clientWidth));
    if (overflowY) flags.push('OVERFLOW_Y+' + round(element.scrollHeight - element.clientHeight));
    if (clippedX) flags.push('CLIPPED_X');
    if (clippedY) flags.push('CLIPPED_Y');
    if (outsideParent) flags.push('OUTSIDE_PARENT');
    if (style.position === 'fixed' || style.position === 'sticky') flags.push(style.position.toUpperCase());
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) flags.push('OUTSIDE_VIEWPORT');

    let depth = 0;
    for (let ancestor = element.parentElement; ancestor && ancestor !== body; ancestor = ancestor.parentElement) depth += 1;
    const indent = '  '.repeat(Math.min(depth, 6));
    const box = '[' + round(rect.left + scrollX) + ',' + round(rect.top + scrollY) + ' ' + round(rect.width) + 'x' + round(rect.height) + ']';
    lines.push(indent + descriptorFor(element) + ' ' + box + (flags.length ? ' ' + flags.join(' ') : ''));
    emitted += 1;
  }
  if (emitted >= MAX_NODES || scanned >= MAX_SCANNED_NODES) {
    lines.push('… layout snapshot bounded after ' + scanned + ' scanned / ' + emitted + ' emitted nodes');
  }
  return lines.join('\n');
})()`;

function layoutSnapshotExpression() {
  return LAYOUT_SNAPSHOT_EXPRESSION;
}

export { layoutSnapshotExpression, normalizeBrowserSnapshotDetail };
