# Performance-Optimierungen

## Umgesetzt

### 1. Tailwind: CDN → Build-Zeit (größter Effekt)
- **Vorher:** `cdn.tailwindcss.com` – Tailwind wurde zur Laufzeit geladen und hat beim Start das DOM gescannt und CSS kompiliert → spürbar langsam.
- **Nachher:** Tailwind v4 mit `@tailwindcss/vite` – CSS wird beim Build erzeugt, keine Laufzeit-Kompilierung. Deutlich schnellerer Start und flüssigeres UI.

### 2. Preconnect für externe Ressourcen
- `preconnect` für cdnjs.cloudflare.com, fonts.googleapis.com, fonts.gstatic.com – Browser baut Verbindungen früher auf, Fonts und Font Awesome laden schneller.

### 3. Code-Splitting (React.lazy)
- Step-Komponenten (ConceptForm, LyricDisplay, LyricsCompareView, StyleDisplay, ArtworkDisplay, DashboardDisplay) werden erst beim Wechsel in den jeweiligen Step geladen.
- Haupt-JS-Bundle von ~584 kB auf ~523 kB reduziert; Step-Chunks je 2–16 kB, on-demand.

### 4. Animationen
- `.orb` mit `will-change: transform` – Browser kann Orbs besser auf der GPU legen, Animationen laufen flüssiger.

### 5. Übersetzungen
- `tr` mit `useMemo(() => t[lang], [lang])` – weniger überflüssige Referenzwechsel und Re-Renders.

## Optional (bei Bedarf)

- **Font Awesome:** Aktuell wird das volle `all.min.css` geladen. Für weniger Gewicht: nur genutzte Icons einbinden (z. B. mit Font Awesome Kit oder SVG-Sprite).
- **Vendor-Chunk:** `@google/genai` und React machen den Haupt-Chunk noch >500 kB. Mit `build.rollupOptions.output.manualChunks` könnten Vendor-Libs in einen separaten, cachebaren Chunk ausgelagert werden.
