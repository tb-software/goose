// TB-Software: remark-Plugin, das Windows-Dateipfade im Fliesstext (C:\..., C:/...,
// \\server\...) in Links verwandelt. Der Link-Renderer in MarkdownContent oeffnet
// solche Links im Explorer (markiert die Datei). So werden AUCH bare Pfade in der
// Antwort klickbar, nicht nur explizite Markdown-Links. Die eigentliche Pfad-Erkennung
// (inkl. Leerzeichen im Pfad) liegt in windowsPath.ts, damit Links und Kontextmenue
// denselben, vollstaendigen Pfad liefern.
import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, RootContent } from 'mdast';
import { matchWindowsPaths } from './windowsPath';

export function remarkLocalPaths() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index == null) return;
      if (parent.type === 'link') return; // schon ein Link
      const value = node.value;
      if (!/[a-zA-Z]:[\\/]|\\\\/.test(value)) return;

      const found = matchWindowsPaths(value);
      if (found.length === 0) return;

      const children: RootContent[] = [];
      let last = 0;
      for (const { index: mi, value: p } of found) {
        if (mi > last) {
          children.push({ type: 'text', value: value.slice(last, mi) });
        }
        children.push({
          type: 'link',
          url: p,
          children: [{ type: 'text', value: p }],
        });
        last = mi + p.length;
      }
      if (last < value.length) children.push({ type: 'text', value: value.slice(last) });

      parent.children.splice(index, 1, ...children);
      return [SKIP, index + children.length];
    });
  };
}
