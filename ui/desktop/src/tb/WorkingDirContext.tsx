// TB-Software: Stellt das Arbeitsverzeichnis des aktuellen Chats fuer tief
// verschachtelte Komponenten bereit (v. a. MarkdownContent), damit bloße
// Dateinamen in KI-Antworten gegen dieses Verzeichnis aufgeloest und klickbar
// gemacht werden koennen (Vorschau rechts) — ohne Prop-Drilling durch die
// Nachrichten-Liste.
import { createContext, useContext } from 'react';

const WorkingDirContext = createContext<string | undefined>(undefined);

export const WorkingDirProvider = WorkingDirContext.Provider;

export const useWorkingDir = (): string | undefined => useContext(WorkingDirContext);
