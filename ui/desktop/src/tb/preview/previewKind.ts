// TB-Software: Datei-Endung -> Vorschau-Typ. Reine Zuordnung, keine Seiteneffekte (SRP).
export type PreviewKind = 'markdown' | 'text' | 'image' | 'video' | 'html' | 'unknown';

const KIND: Record<string, PreviewKind> = {
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text', csv: 'text', json: 'text', xml: 'text', yaml: 'text', yml: 'text',
  ini: 'text', toml: 'text', sql: 'text', css: 'text', ts: 'text', tsx: 'text', js: 'text',
  jsx: 'text', py: 'text', rs: 'text', c: 'text', cpp: 'text', cc: 'text', h: 'text', hpp: 'text',
  cs: 'text', java: 'text', go: 'text', rb: 'text', php: 'text', sh: 'text', ps1: 'text', bat: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', ogg: 'video', mov: 'video', m4v: 'video',
  html: 'html', htm: 'html',
};

function ext(path: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

export function previewKindFor(path: string): PreviewKind {
  return KIND[ext(path)] ?? 'unknown';
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
