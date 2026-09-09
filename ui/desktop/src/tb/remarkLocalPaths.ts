// TB-Software: remark-Plugin, das Windows-Dateipfade im Fliesstext (C:\..., C:/...,
// \\server\...) in Links verwandelt. Der Link-Renderer in MarkdownContent oeffnet
// solche Links im Explorer (markiert die Datei). So werden AUCH bare Pfade in der
// Antwort klickbar, nicht nur explizite Markdown-Links.
import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, RootContent } from 'mdast';

// Pfad bis zum ersten Whitespace/Trennzeichen. Nachlaufende Satzzeichen trennt der Code ab.
const PATH_RE = /(?:[a-zA-Z]:[\\/][^\s<>"'`)\]]+|\\\\[^\s<>"'`)\]]+)/g;

export function remarkLocalPaths() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return;
      if (parent.type === 'link') return; // schon ein Link
      const value = node.value;
      if (!/[a-zA-Z]:[\\/]|\\\\/.test(value)) return;

      const children: RootContent[] = [];
      let last = 0;
      PATH_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PATH_RE.exec(value)) !== null) {
        let match = m[0];
        const trail = match.match(/[.,;:!?)]+$/);
        const tail = trail ? trail[0] : '';
        if (tail) match = match.slice(0, -tail.length);

        if (m.index > last) {
          children.push({ type: 'text', value: value.slice(last, m.index) });
        }
        children.push({
          type: 'link',
          url: match,
          children: [{ type: 'text', value: match }],
        });
        if (tail) children.push({ type: 'text', value: tail });
        last = m.index + m[0].length;
      }
      if (children.length === 0) return;
      if (last < value.length) children.push({ type: 'text', value: value.slice(last) });

      parent.children.splice(index, 1, ...children);
      return [SKIP, index + children.length];
    });
  };
}
