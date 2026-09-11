// TB-Software: Tag-Manager (CRUD). Tags anlegen/bearbeiten/löschen, mit Farbe + Hinweis (Tooltip).
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Trash2, Plus } from 'lucide-react';
import { useTbTags, TAG_PALETTE } from './TagContext';

export default function TagManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { tags, createTag, updateTag, deleteTag } = useTbTags();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);

  const add = () => {
    if (!newName.trim()) return;
    createTag(newName.trim(), newColor);
    setNewName('');
    setNewColor(TAG_PALETTE[(TAG_PALETTE.indexOf(newColor) + 1) % TAG_PALETTE.length]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Tags verwalten</DialogTitle>
          <DialogDescription>
            Stichworte für deine Chats. Jeder Tag wird zu einer Gruppe. Farbe und Hinweis (Tooltip)
            sind frei wählbar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {tags.length === 0 && (
            <p className="text-sm text-text-secondary">Noch keine Tags — unten anlegen.</p>
          )}
          {tags.map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg border border-borderSubtle">
              <ColorPicker value={t.color} onChange={(c) => updateTag(t.id, { color: c })} />
              <Input
                value={t.name}
                onChange={(e) => updateTag(t.id, { name: e.target.value })}
                className="w-40"
                placeholder="Name"
              />
              <Input
                value={t.note ?? ''}
                onChange={(e) => updateTag(t.id, { note: e.target.value })}
                className="flex-1"
                placeholder="Hinweis (wird zum Tooltip)"
              />
              <button
                onClick={() => deleteTag(t.id)}
                className="p-2 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                title="Tag löschen"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-borderSubtle">
          <ColorPicker value={newColor} onChange={setNewColor} />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Neuer Tag…"
            className="flex-1"
          />
          <Button onClick={add} size="sm" disabled={!newName.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Hinzufügen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-6 h-6 rounded-full border border-black/20"
        style={{ backgroundColor: value }}
        title="Farbe wählen"
        aria-label="Farbe wählen"
      />
      {open && (
        <div className="absolute z-50 mt-1 p-2 rounded-lg bg-background-primary border border-borderSubtle shadow-lg grid grid-cols-4 gap-1">
          {TAG_PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="w-6 h-6 rounded-full border border-black/20"
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}
