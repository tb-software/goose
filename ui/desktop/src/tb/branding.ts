// TB-Software Goose — zentrale Anpassungen der rebrandeten, laientauglichen Variante.
// Ein Ort für alle Fork-Schalter, damit Upstream-Merges konfliktarm bleiben.

export interface TbBranding {
  /**
   * IDs der Sidebar-Einträge, die ausgeblendet werden.
   * Gültige IDs: siehe NAV_ITEMS in hooks/useNavigationItems.ts
   * (home, recipes, skills, apps, scheduler, extensions, sessions, settings).
   */
  hiddenNavItems: string[];
}

export const TB_BRANDING: TbBranding = {
  // Entrümpeltes Menü für Endanwender: technisch-fortgeschrittene Punkte weg.
  hiddenNavItems: ['skills', 'apps', 'scheduler'],
};
