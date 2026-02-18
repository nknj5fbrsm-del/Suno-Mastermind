# Suno Mastermind

KI-gestützter Workflow für Song-Erstellung: Lyrics, Style-Prompt und Cover-Art – optimiert für **Suno V5**.  
React + TypeScript (Vite), Google Gemini API (BYOK).

## Features

- **Konzept:** Thema eingeben oder per Würfel; optional Referenz-Audio – KI analysiert Genre, Tempo, Stimmung.
- **Lyrics:** Zwei Varianten beim Erstellen, eine wählen; Strukturvorlagen (Pop, Ballade, Rock, …); Tags & Live-Edit.
- **Style Prompt:** Kompakter V5-Prompt mit Weirdness/Influence, Begründung, Song-Beschreibung.
- **Cover & Story:** KI-Cover, eigener Bildprompt möglich; Songstory editierbar.
- **Für Suno:** Auf der letzten Seite alles kopieren (Lyrics, Clean Text, Style, Story, Cover-Download) und Suno öffnen.

DE/EN, Dark/Light, drei Themes (Mastermind, Sunset, Forest). Archiv in IndexedDB, Export/Import.

## Voraussetzungen

- Node.js 18+
- [Google Gemini API Key](https://aistudio.google.com/app/apikey) (wird in der App eingegeben und lokal gespeichert)

## Setup

```bash
npm install
npm run dev
```

Öffne `http://localhost:5173`, gib deinen Gemini API Key ein und starte.

## Build

```bash
npm run build
```

Output in `dist/` – z.B. mit `npx serve dist` oder über GitHub Pages deployen.

## Lizenz

Privat / nach deiner Wahl.
