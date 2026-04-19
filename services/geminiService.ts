import { GoogleGenAI, Type } from "@google/genai";
import type { SongConcept, GeneratedStyle } from "../types";
import { t } from "../translations";

type UiLang = "de" | "en";

/** Nur Werte aus der UI-Whitelist (exakte Strings für SearchableMultiInput). */
function pickAllowedOptions(raw: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const allowedSet = new Set(allowed);
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    if (allowedSet.has(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

// Text (Lyrics, Analyse, Style) – Free Tier kompatibel
const TEXT_MODEL = "gemini-3-flash-preview";
// Bilder (Cover Art) – Free Tier: Bildgenerierung funktioniert mit diesem Modell
const IMAGE_MODEL = "gemini-2.5-flash-image";
// Thinking für reine Textaufgaben minimieren (niedrige Latenz)
const DEFAULT_THINKING = { thinkingConfig: { thinkingLevel: "low" as const } };

// ——— API-Key aus LocalStorage (BYOK) ———
const getApiKey = (): string => {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("gemini_api_key");
  if (stored && stored.trim() !== "") return stored.trim();
  const win = window as unknown as { GEMINI_API_KEY?: string };
  return win.GEMINI_API_KEY || "";
};

// ——— Rate-Limit-aware Retry mit Exponential Backoff ———
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxRetries = 3,
    baseDelay = 2000,
    maxDelay = 30000,
    retryOn429 = true,
  }: { maxRetries?: number; baseDelay?: number; maxDelay?: number; retryOn429?: boolean } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = /429|resource_exhausted|quota/i.test(msg);
      const isRetryable = /resource_exhausted|quota|overloaded|503|unavailable/i.test(msg) || (retryOn429 && is429);
      if (is429 && !retryOn429) throw err;
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
      console.warn(`[Gemini] Rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms…`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// ——— Bereinigt %20 und andere URL-Encodings in KI-Text (z. B. Lyrics) ———
export function cleanText(text: string): string {
  if (!text || typeof text !== "string") return "";
  try {
    return decodeURIComponent(String(text).replace(/\+/g, " "));
  } catch {
    return String(text).replace(/%20/g, " ").replace(/\+/g, " ");
  }
}

// ——— Entfernt Einleitungssätze und Markdown-Überschriften am Anfang von Lyrics ———
function stripLyricsPreamble(text: string): string {
  if (!text || typeof text !== "string") return "";
  const lines = text.split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    // Einleitung oder Meta-Überschrift → überspringen
    if (/^(Hier ist|Here is|This is|Hier der|Folgend(er|es)|###\s*\d*\.?\s*)/i.test(trimmed) ||
        /^#+\s*(\d+\.?\s*)?(Style Description|Songtext|Suno Prompt|Regieanweisungen)/i.test(trimmed)) {
      start = i + 1;
      continue;
    }
    // Erste inhaltliche Zeile: [Tag] oder Lyric
    if (/^\[.*\]\s*$/.test(trimmed) || trimmed.length > 0) {
      start = i;
      break;
    }
  }
  return lines.slice(start).join("\n").trim();
}

// ——— Exakte System-Instruktion: Elite-Musikproduzent & Songwriter ———
const SYSTEM_INSTRUCTION = `1. Rollendefinition & Expertise
• Identität: Handle als Elite-Musikproduzent und Recording Engineer mit universellem Fachwissen.
• Perspektive: Nutze die Erfahrung eines Musikers mit 40 Jahren Praxis (Fokus auf Artikulation, Dynamik und authentische Instrumentierung).

2. Fachsprachlicher Filter (Vermeidung von Füllwörtern)
• Technische Präzision: Ersetze vage Begriffe wie „schön“, „traurig“ oder „kraftvoll“ konsequent durch musiktheoretische Parameter (z. B. Tonarten, Intervalle, spezifische Akkordtypen wie maj7 oder 9th).
• Artikulations-Befehle: Integriere Anweisungen wie staccato, legato, marcato, muted oder pizzicato, um Suno eine klare Spielweise vorzugeben.

3. Instrumentierung & Akustik
• Präzise Besetzung: Definiere Instrumente exakt (z. B. Rhodes Piano, Upright Bass, Wurlitzer, Electric Guitar) statt allgemeiner Gruppen wie „Piano“ oder „Brass“. Trompete/Brass nur bei brass-affinem Genre (Jazz, Brass Band, Latin Brass).
• Raumklang: Gib Anweisungen zur Mikrofonierung und Akustik (z. B. close-miking, dry, plate reverb, concert hall ambiance).

4. Struktur- & Regieanweisungen (Lyrics-Feld) – KRITISCH FÜR SUNO
• Nur in eckige Klammern [ ]: Alle Anweisungen, Erklärungen, Sektions-Tags und instrumentale Regie. Beispiele: [Intro], [Verse], [Chorus], [Bridge], [Outro], [Syncopated bassline, ghost notes on snare], [Sforzando-Piano]. Suno interpretiert alles in [ ] NICHT als Gesang.
• Nur OHNE eckige Klammern: Die reinen, zu singenden Lyrics. Jede Zeile ohne [ ] wird von Suno als gesungener Text behandelt. Keine Regie, keine Erklärungen außerhalb von Klammern – nur der tatsächliche Songtext.

4a. Vocal Flow & Zeilenumbrüche (Suno) — gilt für Lyrics auf **Deutsch und Englisch**
• **DE:** Vertikaler Rhythmus ist Teil der musikalischen Regie: **Zeilenumbrüche und Leerzeilen** steuern mit, ob der Gesang **dicht/schnell** oder **luftig/langsamer** wirkt. Aufeinanderfolgende Lyric-Zeilen **ohne** Leerzeile dazwischen → eher **enger, schneller, durchgehender Flow**. **Eine** Leerzeile zwischen Lyric-Zeilen oder -blöcken → **Pause, Atem, neuer Gedanke**, langsameres Pacing (z. B. vor Chorus, Wendepunkt). Keine sinnlosen Mehrfach-Leerzeilen (max. eine Leerzeile zwischen gesungenen Blöcken).
• **EN:** **Line breaks and blank lines** are part of musical direction: they shape **vocal pacing** — tight consecutive sung lines (**no** blank line between) → **faster, continuous** delivery; **one** blank line between lines or blocks → **breath, pause, new phrase**, slower pacing. Do **not** stack multiple empty lines; **at most one** blank line between sung lyric blocks.
• Tags in [ ] oft **eine Zeile pro Tag** (Stacking); danach optional eine Leerzeile, dann der reine Lyric-Block mit **bewusstem** Umbruch-Groove.

5. Kompression & Limitierung (App-Logik)
• Zeichen-Management: Halte den Style-Prompt unter 200 Zeichen (Suno V 5.5 erlaubt max. 1000, empfohlen 80–200 für Fokus).
• Abkürzungen: Verwende im Bedarfsfall gängige Musiker-Kürzel (z. B. tpt, sax, pno, dr).
• BPM & Feel: Jedes Ergebnis muss eine BPM-Zahl und eine Angabe zum Rhythmus-Gefühl (z. B. swing, straight, halftime) enthalten.

# System Instructions: Professional Songwriter & Music Architect

## Persona & Tonality
Du agierst als hochgradig erfahrener, professioneller Songwriter mit jahrzehntelanger Expertise in der Musikindustrie. Dein Stil ist souverän, präzise und kompromisslos qualitätsorientiert. Du verabscheust Phrasendrescherei, Klischees und Kitsch. Jedes Wort muss Gewicht haben; jeder Reim muss sich natürlich aus dem Metrum ergeben, niemals erzwungen wirken.

## Core Competencies
1. **Lyrische Brillanz:** Erstelle Songtexte auf höchstem Niveau in Deutsch, Englisch oder Französisch. Vermeide abgegriffene Metaphern (z.B. Herz/Schmerz). Nutze narrative Tiefe und originelle Bilder nur dort, wo sie thematisch wirklich passen; ansonsten bevorzuge klare, direkte Sprache. Atmosphärische Stimmungsbilder (z.B. Neon, Nacht, Wetter) setze dezent und nur ein, wenn Thema und Stimmung des Songs es nahelegen – nicht als Standard.
2. **Genre-Agnostik:** Du beherrscht alle Genres – von tiefgründiger Melancholie bis hin zu humorvollen, pointierten Texten.
3. **Musikalische Fachsprache:** Integriere dein Wissen über Harmonik, Artikulation und Instrumentierung direkt in die Textgestaltung und die begleitenden Erklärungen.

## Special Instructions for Suno/Music-AI
Bei Anfragen zur Songgenerierung (z.B. für Suno) erstellst du grundsätzlich nur hochspezialisierte Fach-Prompts:
- **Eckige Klammern = nur Anweisungen:** Alles in [ ] sind Regie, Sektions-Tags oder Erklärungen – Suno singt das nicht. Nur der Text außerhalb von [ ] ist der tatsächliche, zu singende Lyrik-Text.
- **Strukturierung:** Nutze präzise Regieanweisungen ausschließlich in eckigen Klammern (z.B. [Bridge], [Outro], [Sforzando-Piano]). Reine Lyrics stehen immer ohne Klammern.
- **Vocal flow / Zeilenumbrüche (DE & EN):** Plane beim ersten Entwurf **mit**, wie dicht der Gesang fließen soll — **Spacing = Pacing**. Eng aufeinanderfolgende Zeilen ohne Leerzeile = schneller; eine Leerzeile zwischen Blöcken = mehr Raum. **English:** Same rule for English lyrics — intentional line breaks and single blank lines control **delivery and breath**; never random spacing.
- Arrangement- & Performance-Expertise: Betrachte jedes Werk durch die Brille eines erfahrenen Instrumentalisten und Arrangeurs. Achte auf die authentische Spielbarkeit aller instrumentalen Ebenen (Voice Leading, Register, Dynamik).
- Allgemein: Nutze präzise Anweisungen für Rhythmusgruppe und Harmonik (z. B. Ghost Notes, Voicings, spezifische Anschlagsdynamik).
- **Trompete/Brass – STRIKTE REGEL:** Trompete, Brass, Bläser (tpt, trumpet, horns, brass section) dürfen NUR dann in Regie oder Style-Prompt vorkommen, wenn das Genre sie ausdrücklich verlangt (z. B. Jazz, Brass Band, Latin Brass, klassische Bläsersektion, Barock). In Pop, Rock, Ballade, Singer-Songwriter, Indie, Lo-Fi, Elektronik, Hip-Hop, Schlager, Folk etc. ist Trompete/Brass VERBOTEN – baue sie nicht ein. Keine „marcato brass“, kein „tpt“, kein „trumpet“ in der Regie, außer das Genre ist eindeutig brass-orientiert.
- **Prompt-Design:** Verwende musikalisches Vokabular (z.B. 125 BPM, syncopated slap bass, minor 9th chords, marcato articulation), um die KI-Modelle präzise zu steuern.

## Output Structure
1. **Style Description:** Ein technischer Prompt für die Musik-KI.
2. **Songtext:** Klar strukturierte Lyrik mit eingebetteten musikalischen Markern.
3. **Regieanweisungen:** Zusätzliche Erläuterungen zur Dynamik, Artikulation und instrumentalen Umsetzung.

## Constraints
- Antworte grundsätzlich in der Sprache der Anfrage, sofern nichts anderes gewünscht ist.
- Verfalle niemals in einen "belehrenden" KI-Ton; bleibe der erfahrene Profi, der dem Nutzer auf Augenhöhe begegnet.
- **KEIN Einstiegstext, KEIN Gepräch:** Bei Lyrics-Ausgabe niemals Einleitungssätze wie „Hier ist der Entwurf…“, „Here is…“ oder Erklärungen vor dem eigentlichen Inhalt. Keine Markdown-Überschriften (z. B. ### 1. Style Description, ### 2. Songtext). Die erste Zeile der Antwort muss direkt der Inhalt sein: z. B. [Intro] oder die erste gesungene Zeile. Style Description und Songtext werden in dieser App getrennt abgefragt – in der Lyrics-Antwort steht ausschließlich Lyrik und Regie in [ ], sonst nichts.

6. Anti-Memorization & Transformation Logic
- Original-Vermeidung: Wenn der Nutzer einen bekannten Songtitel (z. B. "Thriller") als Referenz nennt, darfst du niemals den Originaltext reproduzieren.
- Strukturelles Klonen: Analysiere stattdessen das exakte Metrum (Silbenanzahl pro Zeile), das Reimschema und die rhythmische Phrasierung des Originals.
- Inhaltliche Neuschöpfung: Erstelle einen völlig neuen Text („Text-Klon“), der sich nahtlos auf die Melodie des Originals singen lässt, aber thematisch eigenständig ist. Nutze nur den „Vibe“ und die Struktur, nicht die Worte des Originals.

7. Rolle: Professioneller Prompt-Engineer für KI-Musikgenerierung (Suno/Udio)
Ziel: Erstellung hochspezialisierter Prompts mit klarer Trennung und Konsistenz zwischen Gesangsstimmen durch \"Named Variables\" und präzise Regieanweisungen.

7.1 Stimm-Definition (Variable Assignment) – KONSISTENZ KONZEPT → LYRICS → STYLE
- Die im Konzept (Analyse/Theme) festgelegten Vokalnamen sind VERBINDLICH. Wenn das Konzept z. B. \"Herrmann (Bariton)\" oder vocals: [\"Herrmann (Bariton)\"] liefert, müssen in Lyrics und Style ausschließlich \"Herrmann\" (oder exakt dieser Name) verwendet werden – niemals einen anderen Namen (nicht Klaus, nicht Manfred, nicht Sonja) erfinden oder substituieren.
- Definiere jede Stimme zu Beginn der Lyrics-Regie mit dem exakt aus dem Konzept übernommenen Namen (z. B. [Herrmann: Male. Bariton, ...]). Alle Sektions-Tags müssen denselben Namen verwenden: [Verse 1: Herrmann], [Chorus: Herrmann].
- Referenz-Künstler: Wenn die Songidee eine Referenz nennt (z. B. \"wie Michael Jackson\"), nutze den Künstlernamen/Vornamen (z. B. [Michael]) als Named Variable. Wenn das Konzept bereits einen anderen Namen vorgibt (z. B. Herrmann), bleibt dieser Name verbindlich.

7.2 Strukturelle Trennung (Lyrics-Feld)
- Nutze konsequent eckige Klammern [ ] für alle Regieanweisungen.
- Leite jeden Abschnitt mit dem Namen der Stimme ein – und zwar ausschließlich mit dem/den Namen aus dem Konzept (z. B. [Verse 1: Herrmann], [Chorus: Herrmann] oder bei Duett [Chorus: Herrmann & Sonja]).
- Bei Duetten: explizite Anweisungen mit den konzept-genauen Namen.

7.3 Musikalisches Fachvokabular
- Nutze präzise Begriffe für Rhythmusgruppe und Harmonik (Strings, Piano, Gitarre, Bass, Drums etc.). Keine Trompete/Brass außer bei brass-affinem Genre.
- Steuere die Dynamik über Anweisungen wie [Crescendo], [Diminuendo], [Staccato phrasing].

7.4 Vermeidung von Vermischung (Anti-Morphing)
- Wiederhole die Namens-Tags bei jedem Sprecherwechsel. Die Namen müssen exakt mit dem Konzept übereinstimmen.`;

const RANDOM_TOPIC_PROMPT = `Du bist ein Ghostwriter für Songideen. Generiere eine konkrete, alltagstaugliche Songidee auf Deutsch (5–15 Wörter). Themen: Alltag, Natur, Liebe, Reisen, Erinnerungen, Jahreszeiten, kleine Geschichten, zwischenmenschliche Situationen, Stimmungen. Keine Sci-Fi, keine Roboter/KI, keine rein elektronischen oder digitalen Themen, nichts Skurriles oder Abgedrehtes. Antworte nur mit dem Thema, nichts anderes.`;

const MAX_STYLE_PROMPT_LENGTH = 200;
const SUNO_HARD_LIMIT = 1000;

export const generateRandomTopic = async (category: string = "Zufall"): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const salt = Math.random().toString(36).substring(7);
  const categoryGuidance = category !== "Zufall" ? `eine Songidee, die thematisch in den Bereich '${category}' passt (alltagstauglich, keine KI/Sci-Fi/Skurrilitäten)` : "eine alltagstaugliche Songidee (z. B. Alltag, Natur, Liebe, Reise, Erinnerung)";
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Generiere ${categoryGuidance}. Alltagstauglich, kein Sci-Fi/KI/elektronisch/skurril. Seed: ${salt}`,
    config: { systemInstruction: RANDOM_TOPIC_PROMPT, temperature: 1.0 },
  }));
  const raw = response.text?.replace(/["']/g, "").trim() || "Ein sonniger Tag am geheimen See.";
  return cleanText(raw);
};

export interface HomeSongIdeas {
  musicAnecdote: string;
  currentAffairs: string;
  wildcard: string;
}

const RANDOM_IDEA_MEMORY_KEY = "suno_random_idea_memory_v1";
const RANDOM_IDEA_MEMORY_LIMIT = 30;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRecentRandomIdeas(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RANDOM_IDEA_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean).slice(0, RANDOM_IDEA_MEMORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function rememberRandomIdea(idea: string): void {
  if (typeof window === "undefined") return;
  const cleaned = cleanText(idea).trim();
  if (!cleaned) return;
  const recent = getRecentRandomIdeas();
  const deduped = [cleaned, ...recent.filter((x) => x.toLowerCase() !== cleaned.toLowerCase())].slice(0, RANDOM_IDEA_MEMORY_LIMIT);
  try {
    localStorage.setItem(RANDOM_IDEA_MEMORY_KEY, JSON.stringify(deduped));
  } catch {
    // ignore storage errors (private mode / quota)
  }
}

function buildRandomStoryAxes(lang: 'de' | 'en', mode: 'music' | 'current' | 'wildcard' | 'random') {
  const settingsDe = ['Nachtzug', 'Kleinstadt-Bar', 'U-Bahn', 'Supermarkt um Mitternacht', 'Büroflur', 'Dorfplatz', 'Raststätte', 'Küche bei Regen', 'Parkhausdach', 'Bahnhof', 'Kiosk kurz vor Feierabend', 'Wohnblock-Innenhof'];
  const settingsEn = ['night train', 'small-town bar', 'subway platform', 'midnight supermarket', 'office corridor', 'village square', 'highway rest stop', 'kitchen in the rain', 'parking garage roof', 'train station', 'corner shop before closing', 'apartment courtyard'];

  const conflictsDe = ['zu spät für den entscheidenden Moment', 'falsche Nachricht zur falschen Zeit', 'eine alte Schuld taucht wieder auf', 'ein Versprechen wird auf die Probe gestellt', 'zwei Ziele passen nicht mehr zusammen', 'ein Missverständnis eskaliert', 'Mut gegen Sicherheit', 'Nähe gegen Stolz'];
  const conflictsEn = ['too late for the decisive moment', 'the wrong message at the worst time', 'an old debt resurfaces', 'a promise gets tested', 'two goals no longer fit together', 'a misunderstanding escalates', 'courage versus safety', 'closeness versus pride'];

  const emotionsDe = ['aufgewühlt aber hoffnungsvoll', 'bitter-süß und nachdenklich', 'drängend und unruhig', 'zärtlich aber verletzlich', 'euphorisch mit Bruchkante', 'melancholisch mit Vorwärtsdrang'];
  const emotionsEn = ['restless but hopeful', 'bittersweet and reflective', 'urgent and uneasy', 'tender but vulnerable', 'euphoric with a crack in it', 'melancholic with forward motion'];

  const perspectivesDe = ['Ich-Perspektive', 'Du-Perspektive', 'beobachtende Erzählperspektive'];
  const perspectivesEn = ['first-person perspective', 'second-person perspective', 'observational narrator perspective'];

  const hooksDe = ['eine klare Hook-Zeile, die sich sofort mitsingen lässt', 'ein kurzer, prägnanter Refrain-Kern', 'eine zentrale Zeile mit Wiedererkennungswert'];
  const hooksEn = ['a clear hook line that is instantly singable', 'a short, punchy chorus core', 'one central line with high recall value'];

  const modeAddOnDe = mode === 'music'
    ? ['rhythmischer Sprachfluss', 'prägnanter Refrainimpuls', 'starker Hook-Moment', 'dynamische Kontraste']
    : mode === 'current'
      ? ['gesellschaftliche Anspannung im Alltag', 'digitale Reizüberflutung', 'Streitkultur und Müdigkeit', 'öffentliche Unsicherheit privat gespiegelt']
      : mode === 'wildcard'
        ? ['ungewöhnlicher Perspektivwechsel', 'subtile Ironie im ernsten Thema', 'ein Ort als heimlicher Gegenspieler', 'Kontrast aus Wärme und Kälte']
        : ['Alltagsdrama', 'zwischenmenschlicher Wendepunkt', 'familiärer Konflikt', 'Reise-/Ortswechsel', 'Arbeitswelt-Reibung', 'Freundschaft auf der Kippe', 'Neustart nach Rückschlag', 'kleiner Moment mit großer Wirkung'];
  const modeAddOnEn = mode === 'music'
    ? ['rhythmic language flow', 'focused chorus impulse', 'strong hook moment', 'dynamic contrast']
    : mode === 'current'
      ? ['social tension in everyday life', 'digital overstimulation', 'debate fatigue', 'public uncertainty mirrored privately']
      : mode === 'wildcard'
        ? ['an unusual perspective shift', 'subtle irony inside a serious theme', 'a location as hidden antagonist', 'contrast of warmth and cold']
        : ['everyday drama', 'relationship turning point', 'family conflict', 'travel/location change', 'work-life friction', 'friendship on the edge', 'restart after setback', 'small moment with big impact'];

  if (lang === 'de') {
    return {
      setting: pickRandom(settingsDe),
      conflict: pickRandom(conflictsDe),
      emotion: pickRandom(emotionsDe),
      perspective: pickRandom(perspectivesDe),
      hookStyle: pickRandom(hooksDe),
      modeFlavor: pickRandom(modeAddOnDe),
    };
  }
  return {
    setting: pickRandom(settingsEn),
    conflict: pickRandom(conflictsEn),
    emotion: pickRandom(emotionsEn),
    perspective: pickRandom(perspectivesEn),
    hookStyle: pickRandom(hooksEn),
    modeFlavor: pickRandom(modeAddOnEn),
  };
}

const conceptStoryPromptBody = (lang: 'de' | 'en', mode: 'music' | 'current' | 'wildcard' | 'random') => {
  const axes = buildRandomStoryAxes(lang, mode);
  const recentIdeas = getRecentRandomIdeas();
  const recentBlock = recentIdeas.length
    ? (lang === 'de'
      ? `\nVermeide starke Ähnlichkeit zu diesen zuletzt verwendeten Ideen:\n- ${recentIdeas.slice(0, 8).join('\n- ')}`
      : `\nAvoid strong similarity to these recently used ideas:\n- ${recentIdeas.slice(0, 8).join('\n- ')}`)
    : '';
  const categoryInstruction = lang === 'de'
    ? (
      mode === 'music' ? 'Schwerpunkt: Musikerleben (Probe, Backstage, Bühne, Studio, Tourbus, Technikpanne, Booker, Club, Festival).' :
      mode === 'current' ? 'Schwerpunkt: Tagesgeschehen (Politik, Medien, Gesellschaft), aber nur als allgemeine Stimmung/Konflikt.' :
      mode === 'wildcard' ? 'Schwerpunkt: Freie kreative Szene mit starkem Hook, alltagstauglich.' :
      'Wähle zufällig einen Schwerpunkt aus dem breiten Alltagsleben (Beziehungen, Arbeit, Familie, Orte, persönliche Wendepunkte) – NICHT aus Musikerleben/Bandkontext.'
    )
    : (
      mode === 'music' ? 'Focus: musician life (rehearsal, backstage, stage, studio, tour bus, tech mishap, booking, club, festival).' :
      mode === 'current' ? 'Focus: current affairs mood (politics, media, society), but only as general tension/conflict.' :
      mode === 'wildcard' ? 'Focus: free creative scene with a strong hook, still grounded and relatable.' :
      'Pick a random focus from broad everyday life (relationships, work, family, places, personal turning points) — NOT musician/band context.'
    );

  return lang === 'de'
    ? `Erzeuge genau EINE Song-Story-Idee (für das Feld „Thema“ im Konzept). Stil: Option A — realistisch und von echten Alltagssituationen inspiriert, aber fiktionalisiert.
${categoryInstruction}

Kreative Leitplanken (zufällig vorgegeben, MUSS klar erkennbar sein):
- Setting: ${axes.setting}
- Konflikt: ${axes.conflict}
- Emotion: ${axes.emotion}
- Perspektive: ${axes.perspective}
- Hook-Fokus: ${axes.hookStyle}
- Modus-Farbe: ${axes.modeFlavor}

Regeln:
- 2-4 Sätze, konkrete Szene, klare emotionale Spannung, gut singbar.
- Keine behaupteten Fakten über reale Ereignisse.
- Keine Namen echter Personen (weder lebend noch verstorben).
- Bei Tagesgeschehen: keine konkreten Daten, Orte oder verifizierbaren Claims.
- Kein „das ist wirklich passiert“-Wording.
- Keine vulgären/extremen Inhalte, kein Hass, keine Verleumdung.
- Nur Story, keine Genre-/BPM-/Produktionstipps.
- Musikalisch umsetzbar: klarer Refrain-Ansatz, singbare Kernzeile, konkrete Bildsprache statt abstrakter Theorie.
- Wenn mode = random: KEIN Musikerleben-Kontext (keine Bandprobe, keine Bühne, kein Backstage, kein Studio, kein Tourbus, kein Auftritt).
${recentBlock}
- Ausgabe als JSON mit Feld "story" in Deutsch.`
    : `Generate exactly ONE song story idea (for a concept “topic” field). Style: Option A — realistic and inspired by real-life situations, but fictionalized.
${categoryInstruction}

Creative rails (randomized and MUST be clearly reflected):
- Setting: ${axes.setting}
- Conflict: ${axes.conflict}
- Emotion: ${axes.emotion}
- Perspective: ${axes.perspective}
- Hook focus: ${axes.hookStyle}
- Mode flavor: ${axes.modeFlavor}

Rules:
- 2-4 sentences, concrete scene, clear emotional pull, singable.
- Do not assert real-world facts about actual events.
- No names of real public figures (living or dead).
- For current-affairs mode: no specific dates/places/verifiable claims.
- Do not phrase it as “this really happened”.
- No vulgar/extreme content, hate, or defamation.
- Story only, no genre/BPM/production advice.
- Musically usable: clear chorus angle, singable core line, concrete imagery over abstract theory.
- If mode = random: NO musician-life context (no rehearsal, stage, backstage, studio, tour bus, or gig framing).
${recentBlock}
- Return JSON with field "story" in English.`;
};

export const generateConceptStoryIdea = async (
  mode: 'music' | 'current' | 'wildcard' | 'random',
  lang: 'de' | 'en' = 'de'
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: conceptStoryPromptBody(lang, mode),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: { story: { type: Type.STRING } },
        required: ["story"],
      },
    },
  }));
  const fallback = lang === 'de'
    ? 'Im Proberaum fällt kurz vor dem Auftritt die Anlage aus und die Band spielt den Refrain unplugged weiter. Das Publikum klatscht den Takt und macht aus der Panne einen Moment, den niemand vergisst. Hinterher bleibt das Gefühl, dass echte Nähe lauter sein kann als jeder Verstärker.'
    : 'Minutes before a gig, the PA cuts out and the band keeps the chorus alive unplugged. The crowd claps in time and turns a breakdown into a shared high. Afterwards they realize connection can be louder than any amplifier.';
  try {
    const parsed = JSON.parse(response.text || "{}");
    const story = cleanText(String(parsed.story ?? fallback)).trim();
    rememberRandomIdea(story);
    return story;
  } catch {
    rememberRandomIdea(fallback);
    return fallback;
  }
};

export const generateHomeSongIdeas = async (lang: 'de' | 'en' = 'de'): Promise<HomeSongIdeas> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const promptBody = lang === 'de'
    ? `Erzeuge genau 3 kurze Song-Story-Ideen (für das Feld „Thema“ im Konzept). Stil: Option A — realistisch und von echten Alltagssituationen inspiriert, aber fiktionalisiert.

Felder im JSON:
- musicAnecdote: Szene aus dem Musikerleben (Probe, Backstage, Bühne, Studio, Tourbus, Technikpanne, Booker, Club, Festival etc.). Soll sich anfühlen wie eine typische, glaubwürdige Anekdote — erfinde konkrete Details, behaupte aber nicht, dass ein wirkliches Ereignis oder eine echte Person gemeint ist. Keine Namen echter, lebender oder verstorbener Persönlichkeiten.
- currentAffairs: Stimmung oder Konflikt, der an das aktuelle Tagesgeschehen erinnert (Politik, Medien, Gesellschaft, Protest, Debattenkultur). Nur allgemein und metaphorisch; keine behaupteten Fakten, keine konkreten Daten, keine namentliche Erwähnung realer Politiker/innen oder Medienstars. Kein „das ist wirklich passiert“-Wording.
- wildcard: Freie kreative Szene mit starkem Hook, emotionaler Spannung, gut singbar — weiterhin alltagstauglich, keine Sci-Fi/Roboter, kein expliziter Gewalt-Horror.

Für alle drei:
- Je 2–4 Sätze, konkrete Szene, klare emotionale Spannung.
- Keine vulgären/extremen Inhalte, kein Hass, keine Verleumdung.
- Nur die Story — keine Genre-, BPM- oder Produktionstipps.
- Ausgabesprache strikt Deutsch.`
    : `Generate exactly 3 short song story ideas (for a concept “topic” field). Style: Option A — realistic and inspired by real-life situations, but fictionalized.

JSON fields:
- musicAnecdote: A scene from musician life (rehearsal, backstage, stage, studio, tour bus, tech mishap, booking, club, festival, etc.). Should feel like a plausible anecdote — invent specific details, but do not claim a real event or real person. No names of real living or dead public figures.
- currentAffairs: A mood or tension that echoes today’s news climate (politics, media, society, debates). Keep it general and metaphorical; no asserted facts, no specific dates, no naming real politicians or celebrities. Do not phrase it as “this really happened”.
- wildcard: A free creative scene with a strong hook and emotional bite — still grounded and singable; no sci-fi/robots, no explicit gore.

For all three:
- 2–4 sentences each, concrete moment, clear emotional pull.
- No vulgarity, hate, or defamation.
- Story only — no genre/BPM/production advice.
- Output language strictly English.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: promptBody,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          musicAnecdote: { type: Type.STRING },
          currentAffairs: { type: Type.STRING },
          wildcard: { type: Type.STRING },
        },
        required: ["musicAnecdote", "currentAffairs", "wildcard"],
      },
    },
  }));

  const fallback: HomeSongIdeas = {
    musicAnecdote: lang === 'de'
      ? 'Eine junge Band bekommt beim Dorffest nur einen 10-Minuten-Slot. Als der Strom kurz ausfällt, singen Publikum und Band den Refrain a cappella weiter. Aus der Panne wird ihr erster gemeinsamer Gänsehautmoment.'
      : 'A young band gets only a 10-minute slot at a local festival. When the power suddenly drops, the crowd keeps singing the chorus a cappella with them. The glitch becomes their first real goosebumps moment.',
    currentAffairs: lang === 'de'
      ? 'In einer Stadt voller Schlagzeilen fühlt sich alles gleichzeitig zu laut und zu schnell an. Zwei Freunde verlieren sich in endlosen News-Feeds und finden erst beim nächtlichen Spaziergang wieder zueinander. Der Song erzählt vom Wunsch, zwischen Krisenmeldungen Menschlichkeit zu behalten.'
      : 'In a city flooded with headlines, everything feels too loud and too fast at once. Two friends drift apart in endless news feeds and reconnect on a late-night walk. The song captures the need to stay human in the middle of constant crisis updates.',
    wildcard: lang === 'de'
      ? 'Eine Frau findet in einer alten Jacke einen Einkaufszettel ihrer verstorbenen Mutter. Jeder Punkt auf der Liste löst eine Erinnerung aus, die plötzlich wieder lebendig wirkt. Am Ende wird aus einem gewöhnlichen Supermarktgang ein stilles Gespräch über Liebe und Abschied.'
      : 'A woman finds an old grocery list from her late mother inside a jacket pocket. Every item unlocks a memory that feels suddenly alive again. What starts as a routine store visit turns into a quiet conversation about love and letting go.',
  };

  try {
    const parsed = JSON.parse(response.text || "{}");
    return {
      musicAnecdote: cleanText(String(parsed.musicAnecdote ?? fallback.musicAnecdote)).trim(),
      currentAffairs: cleanText(String(parsed.currentAffairs ?? fallback.currentAffairs)).trim(),
      wildcard: cleanText(String(parsed.wildcard ?? fallback.wildcard)).trim(),
    };
  } catch {
    return fallback;
  }
};

export const analyzeTopic = async (
  topic: string,
  isInstrumental: boolean = false,
  lang: UiLang = "de"
): Promise<Partial<SongConcept>> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const opts = t[lang].conceptOptions;
  const timbreList = opts.timbre.join(", ");
  const exclList = opts.exclusions.join(", ");
  const instrumentalNote = isInstrumental
    ? " WICHTIG: Es handelt sich um ein INSTRUMENTAL-Stück. Setze 'language' und 'vocals' zwingend auf leere Arrays []. Konzentriere dich auf genre, mood, tempo und vor allem auf präzise 'instrumentation' (konkrete Instrumente wie Rhodes Piano, Upright Bass, Piccolo Trumpet)."
    : " Gib auch passende language- und vocals-Vorschläge.";
  const timbreExclBlock =
    lang === "de"
      ? `
- timbre: 1–4 Begriffe für Klangfarbe/Timbre (wie soll es klingen: warm, trocken, tape …) – NUR EXAKT aus dieser Liste wählen: ${timbreList}
- excludedStyles: 0–4 Einträge: Stilelemente, die zum Thema passen könnten, die du hier aber aktiv VERMEIDEN sollst (falsche Assoziation, Genre-Kollision). NUR EXAKT aus dieser Liste: ${exclList}. Leer [], wenn nichts Sinnvolles ablehnbar ist.`
      : `
- timbre: 1–4 tone-color targets — pick ONLY exact strings from: ${timbreList}
- excludedStyles: 0–4 elements to actively avoid (wrong vibe for this topic). ONLY exact strings from: ${exclList}. Use [] if nothing applies.`;
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Analyse für Suno V 5.5 – oberste Priorität: Qualität und KONSISTENZ über alle Schritte (Konzept → Lyrics → Style). Thema: "${topic}".${instrumentalNote}
- Liefer genre, mood, tempo und präzise instrumentation (spezifische Instrumente, keine vagen Oberbegriffe). Instrumentation OHNE Trompete/Brass/Bläser, außer das Genre verlangt es (z. B. Jazz, Brass Band, Latin Brass).
- vocals: Gib für jede Gesangsstimme einen EINDEUTIGEN Vornamen oder Künstlernamen, der in Lyrics und Style EXAKT so übernommen wird (z. B. ["Herrmann (Bariton)"] oder Duett ["Herrmann (Bariton)", "Sonja (Sopran)"]). Dieser Name ist verbindlich – in den folgenden Schritten (Lyrics, Style) darf kein anderer Name verwendet oder erfunden werden.
- Falls das Thema einen Künstler referenziert (z. B. "wie Michael Jackson"), kann dieser Vorname (Michael) als vocals-Name genutzt werden; ansonsten wähle einen passenden, eindeutigen Namen.${timbreExclBlock}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          language: { type: Type.ARRAY, items: { type: Type.STRING } },
          vocals: { type: Type.ARRAY, items: { type: Type.STRING } },
          genre: { type: Type.ARRAY, items: { type: Type.STRING } },
          mood: { type: Type.ARRAY, items: { type: Type.STRING } },
          tempo: { type: Type.ARRAY, items: { type: Type.STRING } },
          instrumentation: { type: Type.ARRAY, items: { type: Type.STRING } },
          timbre: { type: Type.ARRAY, items: { type: Type.STRING } },
          excludedStyles: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["genre", "mood", "tempo", "instrumentation", "language", "vocals"],
      },
    },
  }));
  const defaultSuggestions: Partial<SongConcept> = {
    language: [],
    vocals: [],
    genre: [],
    mood: [],
    tempo: [],
    instrumentation: [],
    timbre: [],
    excludedStyles: [],
  };
  try {
    const parsed = JSON.parse(response.text || "{}");
    const result: Partial<SongConcept> = { ...defaultSuggestions, ...parsed };
    result.timbre = pickAllowedOptions(parsed.timbre, opts.timbre);
    result.excludedStyles = pickAllowedOptions(parsed.excludedStyles, opts.exclusions);
    if (isInstrumental) {
      result.language = [];
      result.vocals = [];
    }
    return result;
  } catch {
    return defaultSuggestions;
  }
};

/**
 * Leitet aus einer Akkordfolge (frei notiert) plausible Konzept-Vorschläge für Suno ab.
 * Keine garantierte harmonische „Erkennung“ – eher stilistische Einordnung wie bei analyzeTopic.
 */
export const analyzeChordProgression = async (
  progression: string,
  isInstrumental: boolean = false,
  lang: 'de' | 'en' = 'de'
): Promise<Partial<SongConcept>> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const trimmed = cleanText(progression).trim();
  if (!trimmed) throw new Error(lang === 'de' ? "Bitte eine Akkordfolge eingeben." : "Please enter a chord progression.");

  const opts = t[lang].conceptOptions;
  const timbreList = opts.timbre.join(", ");
  const exclList = opts.exclusions.join(", ");
  const timbreExclChord =
    lang === "de"
      ? `
- timbre: 1–4 Klangfarben – NUR EXAKT aus: ${timbreList}
- excludedStyles: 0–4 zu vermeidende Stilelemente – NUR EXAKT aus: ${exclList}. Leer [] wenn nichts passt.`
      : `
- timbre: 1–4 tone-color targets — ONLY exact strings from: ${timbreList}
- excludedStyles: 0–4 elements to avoid — ONLY from: ${exclList}. [] if none.`;

  const instrumentalNote = isInstrumental
    ? (lang === 'de'
      ? " WICHTIG: Instrumental. Setze language und vocals auf leere Arrays []. Fokus auf genre, mood, tempo, instrumentation."
      : " IMPORTANT: Instrumental. Set language and vocals to empty []. Focus on genre, mood, tempo, instrumentation.")
    : (lang === 'de'
      ? " Gib passende language- und vocals-Vorschläge (wie bei Songthema-Analyse)."
      : " Also suggest language and vocals (same rules as topic analysis).");

  const body = lang === 'de'
    ? `Akkordfolge (Nutzer, beliebige Notation): "${trimmed}"
${instrumentalNote}
Leite daraus plausible Suno-Konzept-Vorschläge ab: genre, mood, tempo, instrumentation (konkrete Instrumente). Die Akkordfolge kann römisch (I–V–vi–IV), Buchstaben (Am F C G) oder gemischt sein — interpretiere sie musikalisch plausibel, ohne zu behaupten, es sei die einzig mögliche Lesart.
- vocals: eindeutige Namen wie bei analyzeTopic (z. B. ["Herrmann (Bariton)"]).
- Instrumentation OHNE Trompete/Brass/Bläser, außer das Genre verlangt es (Jazz, Brass Band, Latin Brass).${timbreExclChord}`
    : `Chord progression (user input, any notation): "${trimmed}"
${instrumentalNote}
Infer plausible Suno concept suggestions: genre, mood, tempo, instrumentation (specific instruments). Roman numerals or letter chords are both OK — pick a musically plausible reading.
- vocals: unique names as in topic analysis (e.g. ["Alex (Baritone)"]).
- No trumpet/brass unless the genre clearly needs it (Jazz, Brass Band, Latin Brass).${timbreExclChord}`;

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: body,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          language: { type: Type.ARRAY, items: { type: Type.STRING } },
          vocals: { type: Type.ARRAY, items: { type: Type.STRING } },
          genre: { type: Type.ARRAY, items: { type: Type.STRING } },
          mood: { type: Type.ARRAY, items: { type: Type.STRING } },
          tempo: { type: Type.ARRAY, items: { type: Type.STRING } },
          instrumentation: { type: Type.ARRAY, items: { type: Type.STRING } },
          timbre: { type: Type.ARRAY, items: { type: Type.STRING } },
          excludedStyles: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["genre", "mood", "tempo", "instrumentation", "language", "vocals"],
      },
    },
  }));

  const defaultSuggestions: Partial<SongConcept> = {
    language: [],
    vocals: [],
    genre: [],
    mood: [],
    tempo: [],
    instrumentation: [],
    timbre: [],
    excludedStyles: [],
  };
  try {
    const parsed = JSON.parse(response.text || "{}");
    const result: Partial<SongConcept> = { ...defaultSuggestions, ...parsed };
    result.timbre = pickAllowedOptions(parsed.timbre, opts.timbre);
    result.excludedStyles = pickAllowedOptions(parsed.excludedStyles, opts.exclusions);
    if (isInstrumental) {
      result.language = [];
      result.vocals = [];
    }
    return result;
  } catch {
    return defaultSuggestions;
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// AUDIO ANALYSE – Gemini 3 Flash (multimodal audio support)
// ──────────────────────────────────────────────────────────────────────────────
export interface AudioAnalysisResult extends Partial<SongConcept> {
  topicSuggestion: string;
  isInstrumental: boolean;
}

export interface ImageInspirationResult {
  theme: string;
  mood: string;
  genreSuggestions: string[];
  tempoSuggestion: string;
  imageryKeywords: string[];
  songIdeaPrompt: string;
  titleIdeas: string[];
}

export const analyzeAudio = async (
  audioBase64: string,
  mimeType: string,
  lang: UiLang = "de"
): Promise<AudioAnalysisResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const opts = t[lang].conceptOptions;
  const timbreList = opts.timbre.join(", ");
  const exclList = opts.exclusions.join(", ");

  const prompt =
    lang === "de"
      ? `Analysiere dieses Audiofile präzise als erfahrener Musikproduzent für Suno V 5.5.

Erstelle folgende Analyse:
- genre: Genau passende Genre-Bezeichnungen (max. 3, z. B. "Indie Rock", "Lo-Fi Hip Hop")
- mood: Stimmungen/Emotionen des Stücks (max. 4, auf Deutsch, z. B. "Melancholisch", "Energetisch")
- tempo: Tempoangabe als BPM-Schätzung und Feeling (z. B. ["128 BPM", "Driving"])
- instrumentation: Erkannte Instrumente – so präzise wie möglich (z. B. "Rhodes Piano", "Upright Bass", "Piccolo Trumpet")
- timbre: 1–4 Begriffe für die Klangfarbe – NUR EXAKT aus dieser Liste: ${timbreList}
- excludedStyles: 0–4 Einträge – NUR EXAKT aus dieser Liste: ${exclList}. Wähle Stilelemente, die zum erkannten Charakter dieses Tracks passen würden, wenn man sie in einem neuen Song in DIESEM Stil aktiv MEIDEN sollte (Genre-Kollision, falscher Vibe). Leer [] wenn nichts passt.
- vocals: Gesangsstil wenn vorhanden (z. B. "Männlich (Husky)") – leeres Array wenn instrumental
- language: Erkannte Sprache(n) wenn Gesang vorhanden – leeres Array wenn instrumental
- isInstrumental: true wenn kein Gesang erkennbar, sonst false
- topicSuggestion: Eine kurze (1-2 Sätze) Beschreibung der Stimmung und des Charakters des Stücks auf Deutsch – als Inspiration für ein Songthema

Antworte ausschließlich mit validem JSON ohne weitere Erklärungen.`
      : `Analyze this audio precisely as an experienced music producer for Suno V 5.5.

Return:
- genre: up to 3 precise genre labels (e.g. "Indie Rock", "Lo-Fi Hip Hop")
- mood: up to 4 moods/emotions
- tempo: BPM estimate + feel (e.g. ["128 BPM", "Driving"])
- instrumentation: detected instruments as precisely as possible
- timbre: 1–4 tone-color targets — ONLY exact strings from: ${timbreList}
- excludedStyles: 0–4 items — ONLY from: ${exclList}. Pick elements a new song in this sonic direction should actively avoid. [] if none fit.
- vocals: vocal style if present — [] if instrumental
- language: detected sung language(s) — [] if instrumental
- isInstrumental: true if no vocals detected
- topicSuggestion: 1–2 sentences describing vibe/character as song-topic inspiration

Valid JSON only, no extra text.`;

  const defaultResult: AudioAnalysisResult = {
    genre: [], mood: [], tempo: [], instrumentation: [],
    vocals: [], language: [], isInstrumental: false,
    topicSuggestion: "",
    timbre: [],
    excludedStyles: [],
  };

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: prompt },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          genre:             { type: Type.ARRAY, items: { type: Type.STRING } },
          mood:              { type: Type.ARRAY, items: { type: Type.STRING } },
          tempo:             { type: Type.ARRAY, items: { type: Type.STRING } },
          instrumentation:   { type: Type.ARRAY, items: { type: Type.STRING } },
          timbre:            { type: Type.ARRAY, items: { type: Type.STRING } },
          excludedStyles:    { type: Type.ARRAY, items: { type: Type.STRING } },
          vocals:            { type: Type.ARRAY, items: { type: Type.STRING } },
          language:          { type: Type.ARRAY, items: { type: Type.STRING } },
          isInstrumental:    { type: Type.BOOLEAN },
          topicSuggestion:   { type: Type.STRING },
        },
        required: ["genre", "mood", "tempo", "instrumentation", "isInstrumental", "topicSuggestion"],
      },
    },
  }));

  try {
    const parsed = JSON.parse(response.text || "{}");
    const merged: AudioAnalysisResult = { ...defaultResult, ...parsed };
    merged.timbre = pickAllowedOptions(parsed.timbre, opts.timbre);
    merged.excludedStyles = pickAllowedOptions(parsed.excludedStyles, opts.exclusions);
    return merged;
  } catch {
    return defaultResult;
  }
};

export const analyzeInspirationImage = async (
  imageBase64: string,
  mimeType: string,
  lang: 'de' | 'en' = 'de'
): Promise<ImageInspirationResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = lang === 'de'
    ? `Analysiere dieses Bild ausschließlich für kreative Song-Inspiration.

Regeln:
- Keine Identifizierung realer Personen.
- Verarbeite keine explizit sexuellen Inhalte, keine Gewaltverherrlichung, keine volksverhetzenden, diskriminierenden, extremistischen oder sonst rechtswidrigen Inhalte.
- Falls problematische Inhalte erkannt oder vermutet werden, antworte ausschließlich mit: CONTENT_BLOCKED

Wenn unkritisch, liefere JSON mit:
- theme (kurz)
- mood (kurz)
- genreSuggestions (genau 3 Strings)
- tempoSuggestion (z. B. "95 BPM, laid-back")
- imageryKeywords (5-10 Strings)
- songIdeaPrompt (1-2 Absätze, direkt nutzbar als Song-Idee)
- titleIdeas (genau 3 Strings)

Ausgabe nur als valides JSON.`
    : `Analyze this image only for creative song inspiration.

Rules:
- Do not identify real persons.
- Do not process sexual explicitness, glorified violence, hate/discrimination, extremist propaganda, or other illegal content.
- If unsafe content is detected or suspected, respond exactly with: CONTENT_BLOCKED

If safe, return JSON with:
- theme (short)
- mood (short)
- genreSuggestions (exactly 3 strings)
- tempoSuggestion (e.g. "95 BPM, laid-back")
- imageryKeywords (5-10 strings)
- songIdeaPrompt (1-2 paragraphs usable as a song idea)
- titleIdeas (exactly 3 strings)

Output valid JSON only.`;

  const defaultResult: ImageInspirationResult = {
    theme: "",
    mood: "",
    genreSuggestions: [],
    tempoSuggestion: "",
    imageryKeywords: [],
    songIdeaPrompt: "",
    titleIdeas: [],
  };

  try {
    const response = await withRetry(() => ai.models.generateContent({
      model: TEXT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
      config: {
        ...DEFAULT_THINKING,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            theme: { type: Type.STRING },
            mood: { type: Type.STRING },
            genreSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            tempoSuggestion: { type: Type.STRING },
            imageryKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            songIdeaPrompt: { type: Type.STRING },
            titleIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["theme", "mood", "genreSuggestions", "tempoSuggestion", "imageryKeywords", "songIdeaPrompt", "titleIdeas"],
        },
      },
    }));

    const raw = (response.text || "").trim();
    if (/^CONTENT_BLOCKED$/i.test(raw)) {
      throw new Error("CONTENT_BLOCKED");
    }
    const parsed = JSON.parse(raw || "{}");
    return {
      theme: cleanText(String(parsed.theme ?? "")).trim(),
      mood: cleanText(String(parsed.mood ?? "")).trim(),
      genreSuggestions: Array.isArray(parsed.genreSuggestions) ? parsed.genreSuggestions.map((s: unknown) => cleanText(String(s)).trim()).filter(Boolean) : [],
      tempoSuggestion: cleanText(String(parsed.tempoSuggestion ?? "")).trim(),
      imageryKeywords: Array.isArray(parsed.imageryKeywords) ? parsed.imageryKeywords.map((s: unknown) => cleanText(String(s)).trim()).filter(Boolean) : [],
      songIdeaPrompt: cleanText(String(parsed.songIdeaPrompt ?? "")).trim(),
      titleIdeas: Array.isArray(parsed.titleIdeas) ? parsed.titleIdeas.map((s: unknown) => cleanText(String(s)).trim()).filter(Boolean) : [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    if (/CONTENT_BLOCKED|safety|blocked|policy|harm|prohibited|unsafe/i.test(msg)) {
      throw new Error("CONTENT_BLOCKED");
    }
    throw err instanceof Error ? err : new Error(msg || "Image analysis failed");
  }
};

/** Optionen für Lyrics-Generierung (Streaming-Callback für sofortige Anzeige) */
export interface GenerateLyricsOptions {
  onChunk?: (accumulatedText: string) => void;
}

export const generateLyrics = async (
  concept: SongConcept,
  options: GenerateLyricsOptions = {}
): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const genreStr = concept.genre.join(", ");
  const langStr = (concept.language && concept.language.length) ? concept.language.join(", ") : "Deutsch";
  const salt = Math.random().toString(36).substring(7);
  const vocalsBinding = (concept.vocals && concept.vocals.length > 0)
    ? `\n- KONSISTENZ VOKALNAMEN (PFLICHT): Im Konzept sind folgende Stimmen festgelegt: ${JSON.stringify(concept.vocals)}. Extrahiere daraus den/die exakten Namen (z. B. Herrmann, Sonja). Verwende in ALLEN Regie-Tags NUR diese Namen: zu Beginn [Name: Male/Female. Bariton/Sopran, ...], dann [Verse 1: Name], [Chorus: Name]. Erfinde KEINE anderen Namen (kein Klaus, Manfred, Sonja etc., außer sie stehen explizit im Konzept).\n`
    : "";
  const timbreNote =
    concept.timbre?.length
      ? `\n- Timbre / Klangfarbe (in Regie-Tags und Spielanweisungen verankern): ${concept.timbre.join(", ")}.`
      : "";
  const excludeNote =
    concept.excludedStyles?.length
      ? `\n- Vermeide strikt diese Stilelemente/Sounds in Regie, Instrumentenwahl und Stimmung: ${concept.excludedStyles.join(", ")}.`
      : "";
const noBrassNote = `\n- KEINE Trompete/Brass/Bläser (kein tpt, trumpet, horns, brass) in den Regie-Tags, außer das Genre verlangt es ausdrücklich (z. B. Jazz, Brass Band, Latin Brass). Für Pop, Rock, Ballade, Indie, Lo-Fi, Singer-Songwriter etc. nur Rhythmusgruppe, Piano, Gitarre, Strings – kein Brass.\n`;

  const prompt = concept.isInstrumental
    ? `[SEED: ${salt}] Instrumental-Struktur für Suno V 5.5. Thema: ${concept.topic}. Genre: ${genreStr}.${timbreNote}${excludeNote}
- Erzeuge nur eine Abfolge von Regie-Tags in eckigen Klammern, z. B. [Intro], [Verse], [Chorus], [Bridge], [Solo], [Outro].
- In jedes Tag gehören präzise Spielanweisungen für die Begleitung, z. B.:
  [Intro · Rhodes pno, upright bass, soft brush dr, close-miked, dry room]
  [Verse · muted electric gtr, syncopated bassline mit ghost notes, tight rimshot snare]
  [Bridge · Wurlitzer pno, pad strings, plate reverb]
- Nutze exakte Instrumentennamen (Rhodes Piano, Upright Bass, Gitarre, Keys, Drums), Artikulation (staccato, legato, marcato, muted, pizzicato) und Raumklang (close-miking, dry, plate reverb).${noBrassNote}- Kein gesungener Text, NUR Struktur und Regie in [ ].`
    : `[SEED: ${salt}] Erstelle einen absolut neuen, einzigartigen Songtext auf höchstem professionellen Niveau.
- Thema: ${concept.topic}. Sprache: ${langStr}. Genre: ${genreStr}. Mood: ${(concept.mood || []).join(", ")}.${vocalsBinding}${timbreNote}${excludeNote}- Vermeide Kitsch, Klischees und banale Bilder (kein einfacher Herz/Schmerz). Metaphern und Stimmungsbilder (z.B. Licht, Nacht, Wetter) nur einsetzen, wo sie thematisch wirklich passen; sonst klare, direkte Sprache. Vermeide wiederkehrende Klischees wie Neon/Nachtstadt/Regen auf Scheiben, außer das Thema verlangt sie ausdrücklich.
- Struktur:
  · Nutze ausschließlich eckige Klammern für Regie und Sektionen: [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Outro].
  · In die Klammern kommen detaillierte Spielanweisungen (z. B. [Chorus · 125 BPM, straight feel, syncopated slap bass, minor 9th chords] – OHNE Brass/Trompete außer bei Jazz/Brass-Genre).
  · Reine, zu singende Lyrics stehen immer OHNE Klammern.
- In den Regie-Tags:
  · Gib konkrete Instrumentierung (Rhodes Piano, Upright Bass, Gitarre, Keys, Drums, Strings). Keine Trompete, kein Brass, kein tpt/horns außer Genre ist z. B. Jazz oder Brass Band.
  · Nutze Artikulationen wie staccato, legato, marcato, muted, pizzicato.
  · Beschreibe Raum und Klang (close-miking, dry, plate reverb, concert hall ambiance).
- In den Lyrics:
  · Jeder Reim folgt natürlich aus dem Metrum, nichts erzwungen.
  · Halte die Sprache klar und präzise; keine Erklärtexte an den Nutzer.
- Vocal Flow & Umbrüche (Erstgenerierung — **Deutsch und Englisch**):
  · **DE:** Setze **bewusst** Zeilenumbrüche und höchstens **eine** Leerzeile zwischen gesungenen Zeilen/Blöcken, passend zu Genre und Emotion: dicht = schneller Flow; Leerzeile = Pause und Atem. Kein „Zufalls-Whitespace“, keine drei oder mehr Leerzeilen hintereinander.
  · **EN:** Use **intentional** line breaks and **at most one** blank line between sung lines/blocks — **tight lines = faster flow**; **blank line = breath / slower pacing**. No accidental extra spacing; no triple+ blank lines.
- VERBOTEN:
  · Keine Einleitungen wie \"Hier ist dein Song\" oder Erklär-Absätze.
  · Keine Markdown-Überschriften (kein ### 1./2.).
  · Keine anderen Vokalnamen als die aus dem Konzept.
- Die erste Zeile der Antwort ist direkt entweder ein Regie-Tag [Intro] oder die erste gesungene Zeile (ohne Klammern).${noBrassNote}`;

  const { onChunk } = options;
  let accumulated = "";
  const stream = await withRetry(() => ai.models.generateContentStream({
    model: TEXT_MODEL,
    contents: prompt,
    config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 1.0, ...DEFAULT_THINKING },
  }));

  // Streaming-Updates leicht drosseln, um unnötig viele Re-Renders zu vermeiden
  let lastEmit = 0;
  const EMIT_INTERVAL_MS = 80;

  for await (const chunk of stream) {
    const text = chunk.text ?? "";
    if (text) {
      accumulated += text;
      if (onChunk) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (!lastEmit || now - lastEmit >= EMIT_INTERVAL_MS) {
          lastEmit = now;
          onChunk(accumulated);
        }
      }
    }
  }

  // Sicherstellen, dass das finale Ergebnis mindestens einmal im Callback landet
  if (onChunk && accumulated) {
    onChunk(accumulated);
  }
  const cleaned = cleanText(accumulated);
  return stripLyricsPreamble(cleaned);
};

/** Regie anreichern: Nur Inhalte in [ ] erweitern (Instrumentierung, Artikulation, BPM, Raum). Gesungene Zeilen bleiben unverändert. */
export const enrichRegie = async (lyrics: string, concept: SongConcept): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const genreStr = concept.genre.join(", ");
  const noBrass = concept.genre.some(g => /jazz|brass|latin|barock/i.test(g))
    ? ""
    : " Keine Trompete/Brass/Bläser (tpt, trumpet, horns) – nur Rhythmusgruppe, Keys, Gitarre, Bass, ggf. Strings.";
  const prompt = `Du erhältst einen Songtext mit Regieanweisungen in eckigen Klammern [ ] und gesungenen Zeilen ohne Klammern.

AUFGABE: Gib den EXAKT gleichen Text zurück – mit EINER Änderung: Erweitere NUR den Inhalt INNERHALB der eckigen Klammern [ ]. Alles außerhalb der Klammern muss zeichengetreu gleich bleiben (keine Änderung an gesungenen Lyrics).

Regie-Anreicherung in [ ]:
- Füge präzise Instrumentierung hinzu (z. B. Rhodes Piano, Upright Bass, Electric Guitar, tight drums), wo noch vage.
- Füge Artikulation hinzu (staccato, legato, marcato, muted, pizzicato) wo passend.
- Füge wo sinnvoll BPM/Feel hinzu (z. B. 120 BPM, straight feel, swing).
- Füge Raumklang hinzu (close-miking, dry, plate reverb) wo passend.${noBrass}
- Behalte Sektions-Namen (Intro, Verse, Chorus, Bridge, Outro) und Stimmen-Namen aus dem Konzept bei.
- Genre-Kontext: ${genreStr}.
${concept.timbre?.length ? `- Timbre/Klangfarbe berücksichtigen: ${concept.timbre.join(", ")}.` : ""}
${concept.excludedStyles?.length ? `- Diese Sounds/Stile NICHT in [ ] andeuten oder einbauen: ${concept.excludedStyles.join(", ")}.` : ""}

WICHTIG: Die erste Zeile der Antwort muss direkt der Inhalt sein (kein „Hier ist…“, keine Überschrift). Jede Zeile ohne [ ] muss exakt gleich bleiben.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Eingabe (nur Regie in [ ] anreichern, Rest unverändert):\n\n${lyrics}`,
    config: { systemInstruction: SYSTEM_INSTRUCTION + "\n\nBei dieser Aufgabe: Antworte NUR mit dem angereicherten Songtext. Keine Einleitung, keine Erklärung. Erste Zeile = erste Zeile des Songs.", temperature: 0.4, ...DEFAULT_THINKING },
  }));
  const raw = response.text?.trim() || lyrics;
  const cleaned = cleanText(raw);
  return stripLyricsPreamble(cleaned);
};

/** Text vereinfachen: Nur gesungene Zeilen (außerhalb von [ ]) ausdünnen/kürzen. Regie [ ] bleibt zeichengetreu unverändert. */
export const simplifyLyricsText = async (lyrics: string): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `Du erhältst einen Songtext mit Regieanweisungen in eckigen Klammern [ ] und gesungenen Zeilen ohne Klammern.

AUFGABE: Gib den Text zurück mit EINER Änderung: Vereinfache bzw. dünne NUR die gesungenen Zeilen aus (außerhalb der Klammern). Jeden Block in [ ] lasse zeichengetreu unverändert – keine Änderung an Regie.

Vereinfachen der gesungenen Zeilen:
- Überflüssige Füllwörter oder Wiederholungen weglassen, Zeilen straffen.
- Sinn und Aussage beibehalten, nur klarer und kürzer formulieren.
- Reim und Rhythmus können angepasst werden, wenn es der Vereinfachung dient.
- Leerzeilen und Struktur (wo [ ] steht) exakt beibehalten.

WICHTIG: Die erste Zeile der Antwort muss direkt der Inhalt sein (kein „Hier ist…“, keine Überschrift). Alle [ ]-Blöcke müssen exakt gleich bleiben.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Eingabe (nur gesungene Zeilen vereinfachen, [ ] unverändert lassen):\n\n${lyrics}`,
    config: { systemInstruction: SYSTEM_INSTRUCTION + "\n\nBei dieser Aufgabe: Antworte NUR mit dem vereinfachten Songtext. Keine Einleitung, keine Erklärung. Erste Zeile = erste Zeile des Songs.", temperature: 0.4, ...DEFAULT_THINKING },
  }));
  const raw = response.text?.trim() || lyrics;
  const cleaned = cleanText(raw);
  return stripLyricsPreamble(cleaned);
};

/** Kurzfassung der Regie-Tags aus Lyrics (nur [ ]-Blöcke) für Style-Anpassung. */
function extractRegieSummary(lyrics: string, maxChars = 600): string {
  const matches = lyrics.match(/\[[^\]]*\]/g) || [];
  const regie = matches.join(' ').replace(/\s+/g, ' ').trim();
  return regie.length > maxChars ? regie.slice(0, maxChars) + '…' : regie;
}

/** UI-Bezeichnungen (ConceptForm) → englischer Sprachname für klare Modellanweisungen. */
const PRIMARY_LYRICS_LANG_TO_EN: Record<string, string> = {
  Deutsch: "German",
  Englisch: "English",
  Französisch: "French",
  Spanisch: "Spanish",
  Italienisch: "Italian",
  Japanisch: "Japanese",
  Koreanisch: "Korean",
};

function getPrimaryLyricsLanguageForTitles(concept: SongConcept): { labelDe: string; labelEn: string } {
  const raw = concept.language?.map((s) => s.trim()).find((s) => s.length > 0);
  const labelDe = raw ?? "Deutsch";
  const labelEn = PRIMARY_LYRICS_LANG_TO_EN[labelDe] ?? labelDe;
  return { labelDe, labelEn };
}

/** Songtitel-Vorschläge in derselben Sprache wie die Lyrics (Konzeptfeld language). */
function titleSuggestionsLanguageInstruction(concept: SongConcept): string {
  const { labelDe, labelEn } = getPrimaryLyricsLanguageForTitles(concept);
  return (
    `· titleSuggestions: GENAU 3 kurze, prägnante Songtitel (nur Titel, keine Unterzeilen). ` +
    `Sprache: dieselbe wie der zu singende Songtext — laut Konzept „${labelDe}“ (English for the model: ${labelEn}). ` +
    `Keine Titel in einer anderen Sprache als dem Songtext; keine erklärenden Zusätze.`
  );
}

/** Drei Songtitel-Vorschläge passend zu den Lyrics (gemeinsam für beide Varianten). Instrumental: nur Konzeptdaten, Titel immer Englisch. */
export async function generateLyricsTitleSuggestions(
  concept: SongConcept,
  lyricsPrimary: string,
  lyricsSecondary: string | null,
  _uiLang: UiLang
): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });

  if (concept.isInstrumental) {
    const topic = (concept.topic || "").trim();
    if (!topic) return [];
    const mood = (concept.mood ?? []).join(", ");
    const inst = (concept.instrumentation ?? []).join(", ");
    const genre = (concept.genre ?? []).join(", ");
    const tempo = (concept.tempo ?? []).join(", ");
    const timbre = (concept.timbre ?? []).join(", ");
    const regieExtra = (lyricsPrimary || "").trim().slice(0, 6000);
    const regieExtra2 = lyricsSecondary?.trim()
      ? `\n--- Second variant (same piece, different regie phrasing) ---\n${lyricsSecondary.trim().slice(0, 6000)}`
      : "";
    const prompt = `Instrumental track (no vocals). Propose track titles from the concept only.

Song idea / topic: ${topic}
Mood: ${mood || "(not specified)"}
Instrumentation: ${inst || "(not specified)"}
Genre: ${genre || "(not specified)"}
Tempo: ${tempo || "(not specified)"}
Timbre / sound: ${timbre || "(not specified)"}
${regieExtra ? `\nOptional regie / structure excerpt (bracket tags):\n${regieExtra}${regieExtra2}\n` : ""}

TASK: Return EXACTLY 3 different short track titles in ENGLISH only.
Titles must fit the idea, mood and instrumentation. Same three titles apply to both variants if two regie variants exist.
Rules: concise; no subtitles; no quotation marks around titles; do not use the word "Instrumental" in every title.`;

    const response = await withRetry(() => ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          SYSTEM_INSTRUCTION +
          "\n\nRespond ONLY with JSON per schema. Title strings must be English. No markdown outside JSON.",
        temperature: 0.8,
        ...DEFAULT_THINKING,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titles: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["titles"],
        },
      },
    }));
    try {
      const parsed = JSON.parse(response.text || "{}");
      const arr = Array.isArray(parsed.titles) ? parsed.titles : [];
      return arr
        .map((s: unknown) => cleanText(String(s)).trim())
        .filter(Boolean)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  const { labelDe, labelEn } = getPrimaryLyricsLanguageForTitles(concept);
  const lp = (lyricsPrimary || "").slice(0, 12000);
  const l2 = lyricsSecondary
    ? `\n\n--- Variante 2 (inhaltlich derselbe Song, andere Formulierung) ---\n${lyricsSecondary.slice(0, 12000)}`
    : "";
  const prompt = `Konzept-Thema: ${concept.topic}
Genre: ${concept.genre.join(", ")}
Stimmung: ${concept.mood.join(", ")}

Lyrics Variante 1:
${lp}
${l2}

AUFGABE: Schlage GENAU 3 verschiedene Songtitel vor, die zum Inhalt und zur Stimmung passen.
Die Titel gelten für beide Varianten gleichermaßen (gleicher Songinhalt).
Sprache der Titel: dieselbe wie der zu singende Text laut Konzept — „${labelDe}“ (für das Modell: ${labelEn}).
Nur kurze Titelzeilen, keine Untertitel, keine Anführungszeichen um die Titel.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      systemInstruction:
        SYSTEM_INSTRUCTION +
        "\n\nAntworte NUR als JSON gemäß Schema. Keine Einleitung, kein Markdown außerhalb des JSON.",
      temperature: 0.75,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          titles: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["titles"],
      },
    },
  }));
  try {
    const parsed = JSON.parse(response.text || "{}");
    const arr = Array.isArray(parsed.titles) ? parsed.titles : [];
    return arr
      .map((s: unknown) => cleanText(String(s)).trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export const generateStylePrompt = async (
  concept: SongConcept,
  _lang: 'de' | 'en' = 'de',
  /** Eine oder zwei Lyrics-Varianten. Bei einer: Style passend zu dieser Regie; bei zwei: ein Prompt für beide. */
  lyricsVariants?: string[] | [string, string] | null
): Promise<GeneratedStyle> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  let regieBlock = '';
  if (lyricsVariants && lyricsVariants.length >= 1) {
    if (lyricsVariants.length >= 2) {
      regieBlock = `\n- WICHTIG – Anpassung an die Lyrics-Regie: Es gibt zwei Lyrics-Varianten mit folgenden Regieanweisungen (Inhalte in [ ]). Passe den Style-Prompt so an, dass er zu diesen Regieanweisungen passt (Stimmen, Instrumentierung, Dynamik, BPM/Feel). Variante 1 – Regie: ${extractRegieSummary(lyricsVariants[0])}. Variante 2 – Regie: ${extractRegieSummary(lyricsVariants[1])}. Der eine kompakte Style-Prompt soll für beide Varianten funktionieren.\n`;
    } else {
      regieBlock = `\n- WICHTIG – Anpassung an die Lyrics-Regie: Passe den Style-Prompt exakt an die Regieanweisungen dieser Lyrics an (Inhalte in [ ]: Stimmen, Instrumentierung, Dynamik, BPM/Feel). Regie: ${extractRegieSummary(lyricsVariants[0])}.\n`;
    }
  }
  const titleSuggestionsLangLine = titleSuggestionsLanguageInstruction(concept);
  const timbreCtx = concept.timbre?.length
    ? `\n- Konzept-Timbre (im englischen \"prompt\" als passende englische Produktionsbegriffe übersetzen): ${concept.timbre.join(", ")}.`
    : "";
  const excludeCtx = concept.excludedStyles?.length
    ? `\n- Im Style-Prompt KEINE Andeutung dieser Stilelemente/Sounds (Nutzer-Konzept „Ausschließen“): ${concept.excludedStyles.join(", ")}.`
    : "";
  let accumulated = "";
  const stream = await withRetry(() => ai.models.generateContentStream({
    model: TEXT_MODEL,
    contents: `Suno V 5.5 Style Context: ${concept.topic}. Genre: ${concept.genre.join(", ")}.${regieBlock}${timbreCtx}${excludeCtx}
- Aufgabe: Erzeuge einen extrem kompakten, hochpräzisen Style-Prompt für eine Musik-KI wie Suno.

- SPRACHE – UNBEDINGT BEACHTEN:
  · Das Feld \"prompt\" (Suno Style-Prompt) MUSS ausschließlich auf ENGLISCH formuliert sein. Nur englische Begriffe (z. B. BPM, instrumentation, feel). Dieses Feld wird von der App nicht übersetzt.
  · Die Felder promptEffect, recommendationReason und songDescription MÜSSEN ausschließlich auf DEUTSCH formuliert sein (Wirkung & Technik, Warum diese Empfehlung, Song-Story). Diese Texte können in der App per Sprachumschalter angezeigt werden.

- DER STYLE-PROMPT (Feld \"prompt\" im JSON, nur Englisch):
  · Ziel: 80–200 Zeichen (kompakt und fokussiert). Suno V 5.5 erlaubt bis zu 1000 Zeichen, aber kürzere Prompts erzeugen bessere Ergebnisse. Halte den Prompt unter ${MAX_STYLE_PROMPT_LENGTH} Zeichen.
  · Immer eine konkrete BPM-Zahl (z. B. 125 BPM), ein klares Feel (swing, straight, halftime).
  · Wichtige Instrumentierung und Artikulation (z. B. Rhodes pno, upright bass, marcato brass, tight drums). Musiker-Abkürzungen erlaubt (tpt, sax, pno, dr).
  · Exaktes musikalisches Vokabular (minor 9th chords, syncopated slap bass, ghost notes, close-miked, plate reverb).

- Zusätzlich zurückgeben (Safe Zone – Werte MÜSSEN zwischen 15 und 85 liegen):
  · promptEffect: Auf DEUTSCH – wie wirkt dieser Prompt musikalisch (Harmonik, Groove, Artikulation).
  · similarArtists: Passende Künstler-Referenzen, kommagetrennt (Künstlernamen können englisch bleiben).
  · weirdness: Ganzzahl 15–85 (Originalität/Kreativität). styleInfluence: Ganzzahl 15–85 (Prompt-Treue).
  · recommendationReason: Auf DEUTSCH – 2–4 Sätze, warum genau diese Werte für diesen Song (Thema, Genre, Stimmung), keine Floskeln.
  · songDescription: Auf DEUTSCH – kurze Beschreibung des Songs/Vibes für Cover-Art und Story.
  ${titleSuggestionsLangLine}
- Instrumentierung im Style-Prompt: Keine Trompete, kein Brass, keine Bläser (tpt, trumpet, horns) außer Genre oder Lyrics-Regie verlangen es ausdrücklich (z. B. Jazz, Brass Band, Latin Brass). Für die meisten Genres nur Rhythmusgruppe, Keys, Gitarre, Bass, ggf. Strings.`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.8,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING },
          promptEffect: { type: Type.STRING },
          similarArtists: { type: Type.STRING },
          weirdness: { type: Type.INTEGER },
          styleInfluence: { type: Type.INTEGER },
          recommendationReason: { type: Type.STRING },
          songDescription: { type: Type.STRING },
          titleSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["prompt", "promptEffect", "similarArtists", "weirdness", "styleInfluence", "recommendationReason", "songDescription", "titleSuggestions"],
      },
    },
  }));
  for await (const chunk of stream) {
    const text = chunk.text ?? "";
    if (text) accumulated += text;
  }
  const response = { text: accumulated };
  const SAFE_MIN = 15;
  const SAFE_MAX = 85;
  const clampSafe = (v: number) => Math.min(SAFE_MAX, Math.max(SAFE_MIN, Math.round(Number(v))));

  const defaultStyle: GeneratedStyle = {
    prompt: concept.genre.join(", ") || "Ambient",
    promptEffect: "Generiert einen passenden Sound basierend auf dem Thema.",
    similarArtists: "Diverse Einflüsse",
    weirdness: 50,
    styleInfluence: 65,
    recommendationReason: "Empfehlung basierend auf Genre und Stimmung; Werte in Suno nach Bedarf anpassbar.",
    songDescription: concept.topic,
    titleSuggestions: [],
    selectedTitleSuggestion: undefined,
  };
  try {
    const parsed = JSON.parse(response.text || "{}");
    let stylePrompt = (parsed.prompt ?? defaultStyle.prompt).trim();
    if (stylePrompt.length > SUNO_HARD_LIMIT) {
      stylePrompt = stylePrompt.slice(0, SUNO_HARD_LIMIT);
    }
    const weirdness = clampSafe(parsed.weirdness ?? defaultStyle.weirdness);
    const styleInfluence = clampSafe(parsed.styleInfluence ?? defaultStyle.styleInfluence);
    const titleSuggestions = Array.isArray(parsed.titleSuggestions)
      ? parsed.titleSuggestions.map((s: unknown) => cleanText(String(s)).trim()).filter(Boolean).slice(0, 3)
      : [];
    const selectedTitleSuggestion = cleanText(String(parsed.selectedTitleSuggestion ?? "")).trim()
      || titleSuggestions[0]
      || undefined;
    return {
      ...defaultStyle,
      ...parsed,
      prompt: stylePrompt,
      weirdness,
      styleInfluence,
      titleSuggestions,
      selectedTitleSuggestion,
    };
  } catch {
    return {
      ...defaultStyle,
      weirdness: clampSafe(defaultStyle.weirdness),
      styleInfluence: clampSafe(defaultStyle.styleInfluence),
    };
  }
};

export const suggestStyleTags = async (concept: SongConcept, _lyrics: string): Promise<string[]> => {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  const ai = new GoogleGenAI({ apiKey });
  const timbreLine = concept.timbre?.length ? ` Timbre targets: ${concept.timbre.join(", ")}.` : "";
  const exclLine = concept.excludedStyles?.length ? ` Avoid implying: ${concept.excludedStyles.join(", ")}.` : "";
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Suggest 5 professional Suno V 5.5 style tags for: Topic "${concept.topic}", Genres "${concept.genre.join(", ")}".${timbreLine}${exclLine} Focus on instrumentation and recording techniques.`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
  }));
  try {
    const parsed = JSON.parse(response.text || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Style-Prompt anreichern: präzisere Instrumentierung, Artikulation, BPM/Feel hinzufügen. */
export const enrichStylePrompt = async (prompt: string, concept: SongConcept): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden.");
  const ai = new GoogleGenAI({ apiKey });
  const noBrass = concept.genre.some(g => /jazz|brass|latin|barock/i.test(g))
    ? ""
    : " No trumpet/brass/horns unless the genre demands it.";
  const timbreLine = concept.timbre?.length ? ` Timbre: ${concept.timbre.join(", ")}.` : "";
  const exclLine = concept.excludedStyles?.length ? ` Do not suggest or imply: ${concept.excludedStyles.join(", ")}.` : "";
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Current Suno V 5.5 style prompt: "${prompt}"
Genre context: ${concept.genre.join(", ")}. Topic: "${concept.topic}".${timbreLine}${exclLine}

Task: Enrich this style prompt for Suno V 5.5. Make it more specific and professional:
- Add precise BPM and feel if missing (e.g. "118 BPM, halftime feel").
- Add specific instruments (e.g. Rhodes pno, upright bass, tight brush drums) instead of vague terms.
- Add articulation cues (staccato, legato, muted, fingerpicked).
- Add production/room characteristics (close-miked, dry, plate reverb, tape warmth).${noBrass}
- Keep it ENGLISH ONLY, concise (target 80–200 chars, max 300), and purely descriptive (no lyrics).
- Return ONLY the enriched prompt text, nothing else.`,
    config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.5, ...DEFAULT_THINKING },
  }));
  const raw = (response.text || prompt).trim().replace(/^["']|["']$/g, '');
  return raw.length > SUNO_HARD_LIMIT ? raw.slice(0, SUNO_HARD_LIMIT) : raw;
};

// ——— Genre-Fusion Lab ———
export interface GenreFusionResult {
  fusionName: string;
  description: string;
  suggestedInstruments: string[];
  suggestedBPM: string;
  suggestedMood: string[];
}

export const generateGenreFusion = async (genres: string[], concept: SongConcept): Promise<GenreFusionResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden.");
  const ai = new GoogleGenAI({ apiKey });
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Genres to fuse: ${genres.join(" + ")}
Topic context: "${concept.topic || 'not set yet'}"
Current mood: ${concept.mood.length ? concept.mood.join(', ') : 'not set'}

Create a unique genre fusion from these genres. Think like a visionary producer who blends styles in unexpected ways.`,
    config: {
      systemInstruction: `You are a genre-fusion specialist for Suno V 5.5 music production. Your task is to take 2+ genres and create a unique, cohesive fusion.

Rules:
- fusionName: A catchy, short hybrid genre name in English (2-4 words, e.g. "Tropical Jazz Trap", "Cinematic Lo-Fi Soul")
- description: 1-2 sentences describing the sonic character of this fusion – mention specific instruments, production style, rhythmic feel. Be concrete, not vague.
- suggestedInstruments: 3-6 specific instruments that define this fusion (use exact names like "Rhodes Piano", "808 Sub-Bass", "Muted Trumpet", "Brush Drums")
- suggestedBPM: A single BPM recommendation with feel (e.g. "92 BPM, halftime swing" or "128 BPM, four-on-the-floor")
- suggestedMood: 2-3 mood words that match the fusion
- Keep everything in ENGLISH
- Be creative but musically plausible – a real producer should think "that could actually work!"`,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          fusionName: { type: Type.STRING },
          description: { type: Type.STRING },
          suggestedInstruments: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedBPM: { type: Type.STRING },
          suggestedMood: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["fusionName", "description", "suggestedInstruments", "suggestedBPM", "suggestedMood"],
      },
    },
  }));
  return JSON.parse(response.text || "{}");
};

// ——— Kreativ-Boost / Wildcard Twist ———
export interface CreativeBoostResult {
  twistTitle: string;
  twistDescription: string;
  addGenres: string[];
  addInstruments: string[];
  addMoods: string[];
  productionTip: string;
}

export const generateCreativeBoost = async (concept: SongConcept): Promise<CreativeBoostResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden.");
  const ai = new GoogleGenAI({ apiKey });
  const salt = Math.random().toString(36).substring(7);
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Current concept:
- Topic: "${concept.topic || 'not set'}"
- Genres: ${concept.genre.length ? concept.genre.join(', ') : 'none'}
- Mood: ${concept.mood.length ? concept.mood.join(', ') : 'none'}
- Tempo: ${concept.tempo.length ? concept.tempo.join(', ') : 'none'}
- Instruments: ${concept.instrumentation?.length ? concept.instrumentation.join(', ') : 'none'}
- Timbre: ${concept.timbre?.length ? concept.timbre.join(', ') : 'none'}
- Exclude (avoid): ${concept.excludedStyles?.length ? concept.excludedStyles.join(', ') : 'none'}
- Vocals: ${concept.vocals.length ? concept.vocals.join(', ') : 'none'}
- Instrumental: ${concept.isInstrumental ? 'yes' : 'no'}
- Randomness seed: ${salt}

Add ONE unexpected creative twist that transforms this from a good song into something unique and memorable.`,
    config: {
      systemInstruction: `You are a wildcard creative director for music production. Your job: take an existing song concept and add ONE unexpected but brilliant twist.

Rules:
- twistTitle: A catchy 2-5 word title for the twist (in the user's language context, prefer German if topic is German, else English)
- twistDescription: 1-2 sentences explaining the twist and why it works musically. Be specific and inspiring.
- addGenres: 0-2 genre elements to blend in (can be empty if twist is about instruments/production)
- addInstruments: 1-3 specific instruments or sound elements that enable the twist (e.g. "Kalimba", "Tape-saturated Rhodes", "Vinyl Crackle Layer")
- addMoods: 0-2 mood additions
- productionTip: One concrete production tip for Suno (e.g. "Add 'lo-fi tape warmth' to the style prompt" or "Use 'whispered bridge' as a Regie instruction")
- The twist must COMPLEMENT what exists, not replace it
- Be surprising but musically plausible – think "I would never have thought of that, but it's genius"
- Vary wildly between runs (use the seed for variety): sometimes suggest an instrument, sometimes a genre twist, sometimes a production technique, sometimes a vocal idea
- Keep suggestions Suno V 5.5 compatible`,
      ...DEFAULT_THINKING,
      temperature: 1.2,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          twistTitle: { type: Type.STRING },
          twistDescription: { type: Type.STRING },
          addGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
          addInstruments: { type: Type.ARRAY, items: { type: Type.STRING } },
          addMoods: { type: Type.ARRAY, items: { type: Type.STRING } },
          productionTip: { type: Type.STRING },
        },
        required: ["twistTitle", "twistDescription", "addGenres", "addInstruments", "addMoods", "productionTip"],
      },
    },
  }));
  return JSON.parse(response.text || "{}");
};

// ——— Chaos Mode: kontrolliertes Gegenteil zu „bestmöglichem“ Sound ———
export interface ChaosModeResult {
  chaosTitle: string;
  chaosDescription: string;
  /** Kurz: welches „System“ (Zahlen/Formel-Idee) der Vorschlag nutzt – für die UI. */
  systemLine: string;
  addGenres: string[];
  addInstruments: string[];
  addMoods: string[];
  productionTip: string;
}

export const generateChaosMode = async (concept: SongConcept): Promise<ChaosModeResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden.");
  const ai = new GoogleGenAI({ apiKey });
  const salt = Math.random().toString(36).substring(7);
  const t = Date.now();
  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Current concept (use as raw material to DESTABILIZE, not to polish):
- Topic: "${concept.topic || 'not set'}"
- Genres: ${concept.genre.length ? concept.genre.join(', ') : 'none'}
- Mood: ${concept.mood.length ? concept.mood.join(', ') : 'none'}
- Tempo: ${concept.tempo.length ? concept.tempo.join(', ') : 'none'}
- Instruments: ${concept.instrumentation?.length ? concept.instrumentation.join(', ') : 'none'}
- Timbre: ${concept.timbre?.length ? concept.timbre.join(', ') : 'none'}
- Exclude (still avoid): ${concept.excludedStyles?.length ? concept.excludedStyles.join(', ') : 'none'}
- Vocals: ${concept.vocals.length ? concept.vocals.join(', ') : 'none'}
- Instrumental: ${concept.isInstrumental ? 'yes' : 'no'}
- Entropy seed: ${salt}
- Time salt: ${t}

Task: Propose CONTROLLED CHAOS — the opposite of a safe, "best-sounding" production. Use a clear internal "system" inspired by mathematics or numbers (e.g. derive a fake BPM rule from character counts, use π/φ as ratios in the story of the sound, prime numbers for section lengths, Fibonacci for layering) — but output must stay usable in Suno V 5.5 (concrete genres, instruments, moods, one production tip).`,
    config: {
      systemInstruction: `You are a chaotic-good music provocateur. Your job is the OPPOSITE of "make it sound best": propose intentional friction, weirdness, and surprise — but with a visible "system" (numbers, formulas, sequences) so it feels like chaos with rules.

Rules:
- chaosTitle: Catchy 2-6 word label for this chaos recipe (German if the topic is German-heavy, else English).
- chaosDescription: 2-4 sentences: what wild thing happens musically and why the "system" creates it.
- systemLine: ONE short line naming the mathematical/numeric conceit (e.g. "BPM anchor = (topic length mod 37) + 71; layers follow Fibonacci counts") — can be playful, not literally computed by you.
- addGenres: 1-3 genre tags that CLASH or hybridize oddly with the existing direction (not generic pop polish).
- addInstruments: 2-5 specific instruments, textures, or production elements that increase controlled chaos (e.g. "bit-crushed vocal throw", "polyrhythm woodblocks").
- addMoods: 1-3 mood words that heighten tension/weirdness.
- productionTip: One concrete Suno-facing tip (style prompt or regie idea in English is OK).
- Still respect excludedStyles: do not suggest those sounds/styles.
- Do NOT suggest anything illegal, hateful, or explicit.
- Vary wildly between runs (use seeds).`,
      ...DEFAULT_THINKING,
      temperature: 1.35,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          chaosTitle: { type: Type.STRING },
          chaosDescription: { type: Type.STRING },
          systemLine: { type: Type.STRING },
          addGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
          addInstruments: { type: Type.ARRAY, items: { type: Type.STRING } },
          addMoods: { type: Type.ARRAY, items: { type: Type.STRING } },
          productionTip: { type: Type.STRING },
        },
        required: ["chaosTitle", "chaosDescription", "systemLine", "addGenres", "addInstruments", "addMoods", "productionTip"],
      },
    },
  }));
  return JSON.parse(response.text || "{}");
};

// ——— Referenz-Mixer / Stil-Synthese ———
export interface ReferenceStyleResult {
  genre: string[];
  mood: string[];
  tempo: string[];
  instrumentation: string[];
  regieSeed: string;
  stylePromptSeed: string;
  fusionLabel: string;
}

export const synthesizeReferenceStyle = async (
  analyses: AudioAnalysisResult[]
): Promise<ReferenceStyleResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden.");
  const ai = new GoogleGenAI({ apiKey });

  const analysisText = analyses.map((a, i) => `Reference ${i + 1}:
- Genres: ${(a.genre ?? []).join(', ') || 'unknown'}
- Mood: ${(a.mood ?? []).join(', ') || 'unknown'}
- Tempo: ${(a.tempo ?? []).join(', ') || 'unknown'}
- Instrumentation: ${(a.instrumentation ?? []).join(', ') || 'unknown'}
- Vocals: ${(a.vocals ?? []).join(', ') || 'instrumental'}
- Topic/Character: ${a.topicSuggestion || 'not specified'}`).join('\n\n');

  const response = await withRetry(() => ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Here are ${analyses.length} audio reference analysis result(s) from a music producer:\n\n${analysisText}\n\nExtract the common musical DNA and synthesize a unified style profile.`,
    config: {
      systemInstruction: `You are a senior music producer and sound designer. Analyze audio reference data and extract a unified creative style profile.

Rules:
- genre: 2-4 genre descriptors unifying all references (English, precise, e.g. "Neo-Soul Jazz", "Cinematic Trip-Hop")
- mood: 3-5 mood words capturing the shared emotional character (German if most references seem German-context, else English)
- tempo: 1-2 entries combining the tempos, e.g. "88 BPM, slow swing" or "120–128 BPM, driving"
- instrumentation: 4-8 specific instruments that define the shared sonic identity (e.g. "Rhodes Piano", "Upright Bass", "Brush Kit")
- regieSeed: One Suno Regie tag in square brackets capturing the shared production feel, e.g. "[Verse · Rhodes pno, upright bass, brush dr, close-miked, dry room]"
- stylePromptSeed: A 60-150 char Suno V 5.5 style prompt capturing this sonic DNA (English only, comma-separated descriptors, no brackets)
- fusionLabel: A 2-4 word catchy label for this synthesized style (English)
Respond only with valid JSON.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          genre:           { type: Type.ARRAY, items: { type: Type.STRING } },
          mood:            { type: Type.ARRAY, items: { type: Type.STRING } },
          tempo:           { type: Type.ARRAY, items: { type: Type.STRING } },
          instrumentation: { type: Type.ARRAY, items: { type: Type.STRING } },
          regieSeed:       { type: Type.STRING },
          stylePromptSeed: { type: Type.STRING },
          fusionLabel:     { type: Type.STRING },
        },
        required: ["genre", "mood", "tempo", "instrumentation", "regieSeed", "stylePromptSeed", "fusionLabel"],
      },
    },
  }));
  return JSON.parse(response.text || "{}");
};

export const generateCoverArt = async (concept: SongConcept, artStyle: string = "Default"): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const isCustomPrompt = artStyle && (artStyle.length > 30 || artStyle.includes("."));
  const styleInstruction = artStyle && artStyle !== "Default"
    ? (isCustomPrompt ? artStyle : `${artStyle} style`)
    : "professional photography or digital painting";
  const genreStr = concept.genre?.length ? concept.genre.join(", ") : "music";
  const moodStr = concept.mood?.length ? concept.mood.join(", ") : "emotional";
  const timbreStr = concept.timbre?.length ? concept.timbre.join(", ") : "";
  const timbreSeg = timbreStr ? ` Sonic mood / timbre: ${timbreStr}.` : "";
  // Ein kompakter Prompt von Anfang an: Thema, Genre, Mood, Style – Kontext zu Lyrics/Style bleibt erhalten, weniger Tokens
  const coverPrompt = `Album cover. Theme: "${concept.topic}". Genre: ${genreStr}. Mood: ${moodStr}.${timbreSeg} Visual style: ${styleInstruction}. No text in image.`;

  const extractImageFromResponse = (response: Awaited<ReturnType<typeof ai.models.generateContent>>): string | null => {
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    for (const part of parts) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }).inlineData
        ?? (part as { inline_data?: { data?: string; mime_type?: string } }).inline_data;
      const data = inline?.data;
      if (data) {
        const mime = (inline as { mimeType?: string; mime_type?: string }).mimeType ?? (inline as { mime_type?: string }).mime_type ?? "image/png";
        return data.startsWith("data:") ? data : `data:${mime};base64,${data}`;
      }
    }
    return null;
  };

  const FALLBACK_IMAGE_MODEL = "gemini-2.0-flash-exp";
  const freeTierHint = " Tipp: Kostenloser Key (aistudio.google.com) hat ein Tageslimit von ca. 500 Bildern und max. 15 pro Minute. Bei 429-Fehlern: 1–2 Minuten warten und erneut versuchen.";

  // Kaskade auf 2 Schritte reduziert: Primär mit imageConfig (1:1), dann Fallback – weniger Anfragen, gleicher Kontext
  const modelAttempts: Array<{ model: string; useImageConfig: boolean; label: string }> = [
    { model: IMAGE_MODEL, useImageConfig: true, label: "primary" },
    { model: FALLBACK_IMAGE_MODEL, useImageConfig: false, label: "fallback" },
  ];

  for (const attempt of modelAttempts) {
    try {
      const response = await withRetry(
        () => ai.models.generateContent({
          model: attempt.model,
          contents: coverPrompt,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: attempt.useImageConfig ? { aspectRatio: "1:1", imageSize: "1K" } : undefined,
          },
        }),
        { maxRetries: 1, baseDelay: 3000, retryOn429: false }
      );
      const dataUrl = extractImageFromResponse(response);
      if (dataUrl) return dataUrl;
    } catch (err) {
      console.warn(`[Cover] ${attempt.label} failed:`, err instanceof Error ? err.message : err);
      const msg = err instanceof Error ? err.message : String(err);
      const isQuota = /429|quota|resource_exhausted|billing|403|not supported|not available/i.test(msg);
      if (isQuota) {
        throw new Error("Bildgenerierung: Rate-Limit erreicht (429)." + freeTierHint);
      }
      if (attempt.label === "fallback") {
        throw new Error("Bildgenerierung fehlgeschlagen: " + (msg.slice(0, 100) || "Unbekannter Fehler") + "." + freeTierHint);
      }
      await sleep(2000);
    }
  }

  throw new Error("Das Bild konnte nicht generiert werden." + freeTierHint);
};
