// TB-Software: SVG-Icons für die Qualitätsrollen.
// Bewusst SVG statt KI-Raster: scharf in jeder Größe, theme-fähig (hell/dunkel), winzig.
// Ein klares Motiv je Rolle, einfarbig (currentColor).

import React from 'react';

export interface RoleIconProps {
  className?: string;
}

// Wissens-Rechercheur: Lupe über Buch
export const WissensRechercheurIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="7" />
    <path d="M21 21l-6-6" />
    <path d="M7 8h6" />
    <path d="M7 12h4" />
    <path d="M3 18c1-1 3-1 4 0" />
  </svg>
);

// Fach-Experte: Zahnrad/Stift
export const FachExperteIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// Koordinator: Taktstock/Knoten
export const KoordinatorIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="2" />
    <circle cx="6" cy="12" r="2" />
    <circle cx="18" cy="12" r="2" />
    <circle cx="12" cy="19" r="2" />
    <path d="M12 7v10" />
    <path d="M8 12h8" />
    <path d="M10 9l-4 3" />
    <path d="M14 9l4 3" />
    <path d="M10 15l-4-3" />
    <path d="M14 15l4-3" />
  </svg>
);

// Lektor: Stift mit Haken
export const LektorIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    <path d="M14 7l3 3" />
  </svg>
);

// Vollständigkeits-Prüfer: Checkliste
export const VollstaendigkeitIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    <path d="M9 16l3 3 8-8" />
  </svg>
);

// Faktenprüfer: Waage/Fakt-Haken
export const FaktenprueferIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18" />
    <path d="M5 7l7-4 7 4" />
    <path d="M5 7l-3 8a3 3 0 0 0 6 0L5 7z" />
    <path d="M19 7l-3 8a3 3 0 0 0 6 0l-3-8z" />
    <path d="M5 21h14" />
  </svg>
);

// Code-Reviewer: </> mit Haken
export const CodeReviewerIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 18l6-6-6-6" />
    <path d="M8 6l-6 6 6 6" />
    <path d="M14 4l-4 16" />
    <path d="M20 12a8 8 0 0 1-8 8" />
  </svg>
);

// QS/Test: Kolben/Play
export const QsTestIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3" />
    <line x1="22" y1="4" x2="22" y2="20" />
  </svg>
);

// Sicherheits-Prüfer: Schild
export const SicherheitsPrueferIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

// Datenschutz-Prüfer: Schloss
export const DatenschutzPrueferIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    <circle cx="12" cy="16" r="1" />
  </svg>
);

// Kosten-Wächter: Münze/Tacho
export const KostenWaechterIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

// Kunden-Anwalt: Person mit Herz/Ziel
export const KundenAnwaltIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
    <path d="M16 11a2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
  </svg>
);

// Compliance/Recht: Paragraph §
export const ComplianceIcon: React.FC<RoleIconProps> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 6v12" />
    <path d="M10 18v-6a2 2 0 0 0-2-2H6" />
    <path d="M18 6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2" />
  </svg>
);

// Mapping von Rolle-ID zu Icon
export const ROLE_ICONS: Record<string, React.FC<RoleIconProps>> = {
  'wissens-rechercheur': WissensRechercheurIcon,
  'fach-experte': FachExperteIcon,
  'koordinator': KoordinatorIcon,
  'lektor': LektorIcon,
  'vollstaendigkeit': VollstaendigkeitIcon,
  'faktenpruefer': FaktenprueferIcon,
  'code-reviewer': CodeReviewerIcon,
  'qs-test': QsTestIcon,
  'sicherheits-pruefer': SicherheitsPrueferIcon,
  'datenschutz-pruefer': DatenschutzPrueferIcon,
  'kosten-waechter': KostenWaechterIcon,
  'kunden-anwalt': KundenAnwaltIcon,
  'compliance': ComplianceIcon,
};