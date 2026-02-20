import { GoogleGenAI, Type } from "@google/genai";
import type { SongConcept, GeneratedStyle } from "../types";

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
• Präzise Besetzung: Definiere Instrumente exakt (z. B. Rhodes Piano, Upright Bass, Piccolo Trumpet) statt allgemeiner Gruppen wie „Piano“ oder „Brass“.
• Raumklang: Gib Anweisungen zur Mikrofonierung und Akustik (z. B. close-miking, dry, plate reverb, concert hall ambiance).

4. Struktur- & Regieanweisungen (Lyrics-Feld) – KRITISCH FÜR SUNO
• Nur in eckige Klammern [ ]: Alle Anweisungen, Erklärungen, Sektions-Tags und instrumentale Regie. Beispiele: [Intro], [Verse], [Chorus], [Bridge], [Outro], [Syncopated bassline, ghost notes on snare], [Sforzando-Piano]. Suno interpretiert alles in [ ] NICHT als Gesang.
• Nur OHNE eckige Klammern: Die reinen, zu singenden Lyrics. Jede Zeile ohne [ ] wird von Suno als gesungener Text behandelt. Keine Regie, keine Erklärungen außerhalb von Klammern – nur der tatsächliche Songtext.

5. Kompression & Limitierung (App-Logik)
• Zeichen-Management: Halte den Style-Prompt unter 120 Zeichen.
• Abkürzungen: Verwende im Bedarfsfall gängige Musiker-Kürzel (z. B. tpt, sax, pno, dr).
• BPM & Feel: Jedes Ergebnis muss eine BPM-Zahl und eine Angabe zum Rhythmus-Gefühl (z. B. swing, straight, halftime) enthalten.

# System Instructions: Professional Songwriter & Music Architect

## Persona & Tonality
Du agierst als hochgradig erfahrener, professioneller Songwriter mit jahrzehntelanger Expertise in der Musikindustrie. Dein Stil ist souverän, präzise und kompromisslos qualitätsorientiert. Du verabscheust Phrasendrescherei, Klischees und Kitsch. Jedes Wort muss Gewicht haben; jeder Reim muss sich natürlich aus dem Metrum ergeben, niemals erzwungen wirken.

## Core Competencies
1. **Lyrische Brillanz:** Erstelle Songtexte auf höchstem Niveau in Deutsch, Englisch oder Französisch. Vermeide abgegriffene Metaphern (z.B. Herz/Schmerz). Nutze stattdessen narrative Tiefe und originelle Bilder.
2. **Genre-Agnostik:** Du beherrscht alle Genres – von tiefgründiger Melancholie bis hin zu humorvollen, pointierten Texten.
3. **Musikalische Fachsprache:** Integriere dein Wissen über Harmonik, Artikulation und Instrumentierung direkt in die Textgestaltung und die begleitenden Erklärungen.

## Special Instructions for Suno/Music-AI
Bei Anfragen zur Songgenerierung (z.B. für Suno) erstellst du grundsätzlich nur hochspezialisierte Fach-Prompts:
- **Eckige Klammern = nur Anweisungen:** Alles in [ ] sind Regie, Sektions-Tags oder Erklärungen – Suno singt das nicht. Nur der Text außerhalb von [ ] ist der tatsächliche, zu singende Lyrik-Text.
- **Strukturierung:** Nutze präzise Regieanweisungen ausschließlich in eckigen Klammern (z.B. [Bridge], [Outro], [Sforzando-Piano], [Staccato Brass Riff]). Reine Lyrics stehen immer ohne Klammern.
- Arrangement- & Performance-Expertise: Betrachte jedes Werk durch die Brille eines erfahrenen Instrumentalisten und Arrangeurs. Achte auf die authentische Spielbarkeit aller instrumentalen Ebenen (Voice Leading, Register, Dynamik).
- Allgemein: Nutze präzise Anweisungen für Rhythmusgruppe und Harmonik (z. B. Ghost Notes, Voicings, spezifische Anschlagsdynamik).
- Bläser-Spezialisierung: Brass (Trompete, Posaune, etc.) und spezielle Trompetenarten nur dann vorschlagen oder in Regie einbauen, wenn sie zum Genre und Stil des Stücks passen – nicht in jeden Song. Bei Einsatz: korrekte Phrasierung, Atemführung und Artikulation (z. B. Harmon/Cup Mute, Falls, Doits, Shake-Vibrato). Trompetenarten: Piccolo Trumpet – sehr hoher, heller Klang, vorrangig Barock (Bach, Händel); berühmte Ausnahme: Solo in „Penny Lane“. Flügelhorn – für soulige, warme Solos. Die klassische B-Trompete (Bb) findet in vielen Feldern Anwendung: Jazz, Pop, Klassik, Pop-Brass-Ensembles usw.
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

7.1 Stimm-Definition (Variable Assignment)
- Analysiere in deiner Rolle zuerst, ob die Gesangsbesetzung Male, Female oder Duett ist, und nimm diese Information in jede Vocalbeschreibung auf (z. B. \"Male lead\", \"Female lead\", \"Duet: Male & Female\").
- Definiere jede Stimme zu Beginn des Style-Prompts bzw. am Anfang der Lyrics-Regie mit einem eindeutigen Namen in eckigen Klammern (z. B. [Manfred], [Sonja]).
- Verknüpfe den Namen sofort mit spezifischen Attributen: Besetzung (Male/Female/Duett), Stimmlage (Bariton, Sopran, Tenor), Timbre (gritty, breathy, warm, bright) und Artikulation (legato, staccato, vibrato).
- Beispiel: [Manfred: Male. Deep, resonant Baritone, chest voice.] [Sonja: Female. Ethereal, bright Sopran, head voice.] Bei Duett: [Duet: Male & Female. Manfred & Sonja in harmony.]
- Referenz-Künstler: Wenn die Songidee eine Referenz nennt (z. B. \"Song der klingt wie Thriller von Michael Jackson\", \"im Stil von Adele\"), nutze den Künstlernamen bzw. Vornamen (z. B. [Michael], [Adele]) als Named Variable für die Gesangsregie in den Lyrics. Bei \"Michael Jackson\" → [Verse 1: Michael], [Chorus: Michael]; bei \"Adele\" → [Adele]. So ordnet Suno die Stimmfarbe/den Stil korrekt zu.

7.2 Strukturelle Trennung (Lyrics-Feld)
- Nutze konsequent eckige Klammern [ ] für alle Regieanweisungen.
- Leite jeden Abschnitt mit dem Namen der Stimme ein (Anker-Effekt): [Verse 1: Manfred], [Chorus: Sonja], [Verse 2: Michael].
- Bei Duetten: explizite Anweisungen für die Interaktion – [Duet: Manfred & Sonja in Harmony], [Call and Response: Manfred / Sonja].

7.3 Musikalisches Fachvokabular
- Nutze präzise Begriffe für Instrumentierung und Harmonik, um den Kontext für die Stimmen zu festigen (z. B. Low Brass for Manfred's entries, High Strings for Sonja's arcs).
- Steuere die Dynamik über Anweisungen wie [Crescendo], [Diminuendo], [Staccato phrasing].

7.4 Vermeidung von Vermischung (Anti-Morphing)
- Wiederhole die Namens-Tags bei jedem Sprecherwechsel, auch bei kurzen Parts.
- Bei Ad-libs explizite Tags setzen: [Ad-libs: Sonja - high riffs], [Ad-lib: Michael - spoken].`;

const RANDOM_TOPIC_PROMPT = `Du bist ein Ghostwriter für Songideen. Generiere eine konkrete, alltagstaugliche Songidee auf Deutsch (5–15 Wörter). Themen: Alltag, Natur, Liebe, Reisen, Erinnerungen, Jahreszeiten, kleine Geschichten, zwischenmenschliche Situationen, Stimmungen. Keine Sci-Fi, keine Roboter/KI, keine rein elektronischen oder digitalen Themen, nichts Skurriles oder Abgedrehtes. Antworte nur mit dem Thema, nichts anderes.`;

const MAX_STYLE_PROMPT_LENGTH = 120;

export const generateRandomTopic = async (category: string = "Zufall"): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const salt = Math.random().toString(36).substring(7);
  const categoryGuidance = category !== "Zufall" ? `eine Songidee, die thematisch in den Bereich '${category}' passt (alltagstauglich, keine KI/Sci-Fi/Skurrilitäten)` : "eine alltagstaugliche Songidee (z. B. Alltag, Natur, Liebe, Reise, Erinnerung)";
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Generiere ${categoryGuidance}. Alltagstauglich, kein Sci-Fi/KI/elektronisch/skurril. Seed: ${salt}`,
    config: { systemInstruction: RANDOM_TOPIC_PROMPT, temperature: 1.0, ...DEFAULT_THINKING },
  });
  const raw = response.text?.replace(/["']/g, "").trim() || "Ein sonniger Tag am geheimen See.";
  return cleanText(raw);
};

export const analyzeTopic = async (topic: string, isInstrumental: boolean = false): Promise<Partial<SongConcept>> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const instrumentalNote = isInstrumental
    ? " WICHTIG: Es handelt sich um ein INSTRUMENTAL-Stück. Setze 'language' und 'vocals' zwingend auf leere Arrays []. Konzentriere dich auf genre, mood, tempo und vor allem auf präzise 'instrumentation' (konkrete Instrumente wie Rhodes Piano, Upright Bass, Piccolo Trumpet)."
    : " Gib auch passende language- und vocals-Vorschläge.";
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Analyse für Suno V5 – oberste Priorität: Qualität der Vorschläge für Style und Spielanweisungen. Thema: "${topic}".${instrumentalNote} Liefer genre, mood, tempo und präzise instrumentation (spezifische Instrumente, keine vagen Oberbegriffe). Diese Inspiration ist entscheidend für den späteren Style-Prompt und die Regieanweisungen. Falls das Thema einen Künstler oder Song referenziert (z. B. "klingt wie Thriller von Michael Jackson"), behalte diese Referenz im Kontext – bei der späteren Lyrics-Generierung wird der Künstlername/Vorname (z. B. Michael) als Named Variable in den Gesangsregie-Tags verwendet.`,
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
        },
        required: ["genre", "mood", "tempo", "instrumentation", "language", "vocals"],
      },
    },
  });
  const defaultSuggestions: Partial<SongConcept> = {
    language: [],
    vocals: [],
    genre: [],
    mood: [],
    tempo: [],
    instrumentation: [],
  };
  try {
    const parsed = JSON.parse(response.text || "{}");
    const result = { ...defaultSuggestions, ...parsed };
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

export const analyzeAudio = async (
  audioBase64: string,
  mimeType: string
): Promise<AudioAnalysisResult> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Analysiere dieses Audiofile präzise als erfahrener Musikproduzent für Suno V5.

Erstelle folgende Analyse:
- genre: Genau passende Genre-Bezeichnungen (max. 3, z. B. "Indie Rock", "Lo-Fi Hip Hop")
- mood: Stimmungen/Emotionen des Stücks (max. 4, auf Deutsch, z. B. "Melancholisch", "Energetisch")
- tempo: Tempoangabe als BPM-Schätzung und Feeling (z. B. ["128 BPM", "Driving"])
- instrumentation: Erkannte Instrumente – so präzise wie möglich (z. B. "Rhodes Piano", "Upright Bass", "Piccolo Trumpet")
- vocals: Gesangsstil wenn vorhanden (z. B. "Männlich (Husky)") – leeres Array wenn instrumental
- language: Erkannte Sprache(n) wenn Gesang vorhanden – leeres Array wenn instrumental
- isInstrumental: true wenn kein Gesang erkennbar, sonst false
- topicSuggestion: Eine kurze (1-2 Sätze) Beschreibung der Stimmung und des Charakters des Stücks auf Deutsch – als Inspiration für ein Songthema

Antworte ausschließlich mit validem JSON ohne weitere Erklärungen.`;

  const defaultResult: AudioAnalysisResult = {
    genre: [], mood: [], tempo: [], instrumentation: [],
    vocals: [], language: [], isInstrumental: false,
    topicSuggestion: "",
  };

  const response = await ai.models.generateContent({
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
          vocals:            { type: Type.ARRAY, items: { type: Type.STRING } },
          language:          { type: Type.ARRAY, items: { type: Type.STRING } },
          isInstrumental:    { type: Type.BOOLEAN },
          topicSuggestion:   { type: Type.STRING },
        },
        required: ["genre", "mood", "tempo", "instrumentation", "isInstrumental", "topicSuggestion"],
      },
    },
  });

  try {
    const parsed = JSON.parse(response.text || "{}");
    return { ...defaultResult, ...parsed };
  } catch {
    return defaultResult;
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
  const prompt = concept.isInstrumental
    ? `[SEED: ${salt}] Instrumental-Struktur für Suno V5. Thema: ${concept.topic}. Genre: ${genreStr}. 
- Erzeuge nur eine Abfolge von Regie-Tags in eckigen Klammern, z. B. [Intro], [Verse], [Chorus], [Bridge], [Solo], [Outro].
- In jedes Tag gehören präzise Spielanweisungen für die Begleitung, z. B.:
  [Intro · Rhodes pno, upright bass, soft brush dr, close-miked, dry room]
  [Verse · muted electric gtr, syncopated bassline mit ghost notes, tight rimshot snare]
  [Bridge · marcato brass riff (tpt, sax), staccato, plate reverb]
- Nutze exakte Instrumentennamen (Rhodes Piano, Upright Bass, Piccolo Trumpet usw.), Artikulation (staccato, legato, marcato, muted, pizzicato) und Raumklang (close-miking, dry, plate reverb, concert hall ambiance).
- Kein gesungener Text, NUR Struktur und Regie in [ ].`
    : `[SEED: ${salt}] Erstelle einen absolut neuen, einzigartigen Songtext auf höchstem professionellen Niveau.
- Thema: ${concept.topic}. Sprache: ${langStr}. Genre: ${genreStr}. Mood: ${(concept.mood || []).join(", ")}.
- Vermeide Kitsch, Klischees und banale Bilder (kein einfacher Herz/Schmerz). Nutze originelle, narrativ starke Metaphern.
- Struktur:
  · Nutze ausschließlich eckige Klammern für Regie und Sektionen: [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Outro].
  · In die Klammern kommen detaillierte Spielanweisungen (z. B. [Chorus · 125 BPM, straight feel, syncopated slap bass, minor 9th chords, marcato brass]).
  · Reine, zu singende Lyrics stehen immer OHNE Klammern.
- In den Regie-Tags:
  · Gib konkrete Instrumentierung (Rhodes Piano, Upright Bass, Piccolo Trumpet, etc.).
  · Nutze Artikulationen wie staccato, legato, marcato, muted, pizzicato.
  · Beschreibe Raum und Klang (close-miking, dry, plate reverb, concert hall ambiance).
- In den Lyrics:
  · Jeder Reim folgt natürlich aus dem Metrum, nichts erzwungen.
  · Halte die Sprache klar und präzise; keine Erklärtexte an den Nutzer.
- VERBOTEN:
  · Keine Einleitungen wie \"Hier ist dein Song\" oder Erklär-Absätze.
  · Keine Markdown-Überschriften (kein ### 1./2.).
- Die erste Zeile der Antwort ist direkt entweder ein Regie-Tag [Intro] oder die erste gesungene Zeile (ohne Klammern).
- Named Variables: Wenn das Thema einen Künstler/Song referenziert (z. B. "wie Michael Jackson"), nutze den Vornamen bzw. Künstlernamen in den Regie-Tags für die Gesangsstimme: [Verse 1: Michael], [Chorus: Michael]. Definiere die Stimme zu Beginn (z. B. [Michael: Tenor, warm, breathy]).`;

  const { onChunk } = options;
  let accumulated = "";
  const stream = await ai.models.generateContentStream({
    model: TEXT_MODEL,
    contents: prompt,
    config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 1.0, ...DEFAULT_THINKING },
  });
  for await (const chunk of stream) {
    const text = chunk.text ?? "";
    if (text) {
      accumulated += text;
      onChunk?.(accumulated);
    }
  }
  const cleaned = cleanText(accumulated);
  return stripLyricsPreamble(cleaned);
};

export const generateStylePrompt = async (concept: SongConcept, lang: 'de' | 'en' = 'de'): Promise<GeneratedStyle> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  const reasonLang = lang === 'en' ? 'in English' : 'auf Deutsch';
  let accumulated = "";
  const stream = await ai.models.generateContentStream({
    model: TEXT_MODEL,
    contents: `Suno V5 Style Context: ${concept.topic}. Genre: ${concept.genre.join(", ")}.
- Aufgabe: Erzeuge einen extrem kompakten, hochpräzisen Style-Prompt für eine Musik-KI wie Suno.
- DER STYLE-PROMPT (Feld \"prompt\" im JSON) muss:
  · Streng kürzer als ${MAX_STYLE_PROMPT_LENGTH} Zeichen sein.
  · Immer eine konkrete BPM-Zahl enthalten (z. B. 125 BPM).
  · Ein klares Feel enthalten (z. B. swing, straight, halftime).
  · Wichtige Instrumentierung und Artikulation nennen (z. B. \"Rhodes pno, upright bass, marcato brass, tight drums\").
  · Gern Musiker-Abkürzungen verwenden (tpt, sax, pno, dr), um Zeichen zu sparen.
- Nutze exaktes musikalisches Vokabular (minor 9th chords, syncopated slap bass, ghost notes, close-miked, plate reverb).
- Zusätzlich zurückgeben (Safe Zone – beide Werte MÜSSEN zwischen 15 und 85 liegen):
  · promptEffect: Wie wirkt dieser Prompt musikalisch (Fokus auf Harmonik, Groove, Artikulation).
  · similarArtists: Einige passende Referenzen (kommagetrennt).
  · weirdness: Ganzzahl 15–85 (Originalität/Kreativität). Wähle bewusst: experimentelles Genre/avantgardistisch → eher höher (z. B. 55–75); Mainstream-Pop/klassisch → eher niedriger (z. B. 25–45). Niemals unter 15 oder über 85.
  · styleInfluence: Ganzzahl 15–85 (Treue zum Text- und Konzept-Prompt). Stark textgetrieben/Story wichtig → eher höher (z. B. 65–85); mehr Freiraum für Suno → eher niedriger (z. B. 25–45). Niemals unter 15 oder über 85.
  · recommendationReason: Kurze Begründung (2–4 Sätze ${reasonLang}), warum genau DIESE Werte für DIESEN Song gewählt wurden – konkret auf Thema, Genre und Stimmung eingehen, keine generischen Floskeln.
  · songDescription: Kurze Beschreibung des Songs/Vibes für Cover-Art und Story.`,
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
        },
        required: ["prompt", "promptEffect", "similarArtists", "weirdness", "styleInfluence", "recommendationReason", "songDescription"],
      },
    },
  });
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
  };
  try {
    const parsed = JSON.parse(response.text || "{}");
    let stylePrompt = (parsed.prompt ?? defaultStyle.prompt).trim();
    if (stylePrompt.length > MAX_STYLE_PROMPT_LENGTH) {
      stylePrompt = stylePrompt.slice(0, MAX_STYLE_PROMPT_LENGTH);
    }
    const weirdness = clampSafe(parsed.weirdness ?? defaultStyle.weirdness);
    const styleInfluence = clampSafe(parsed.styleInfluence ?? defaultStyle.styleInfluence);
    return {
      ...defaultStyle,
      ...parsed,
      prompt: stylePrompt,
      weirdness,
      styleInfluence,
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
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Suggest 5 professional Suno V5 style tags for: Topic "${concept.topic}", Genres "${concept.genre.join(", ")}". Focus on instrumentation and recording techniques.`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      ...DEFAULT_THINKING,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
    },
  });
  try {
    const parsed = JSON.parse(response.text || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const generateCoverArt = async (concept: SongConcept, artStyle: string = "Default"): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden. Bitte in der App speichern.");
  const ai = new GoogleGenAI({ apiKey });
  // Eigener Prompt: längere Texte als volle Style-Anweisung nutzen, Presets mit " style" anhängen
  const isCustomPrompt = artStyle && (artStyle.length > 30 || artStyle.includes("."));
  const styleInstruction = artStyle && artStyle !== "Default"
    ? (isCustomPrompt ? artStyle : `${artStyle} style`)
    : "professional photography or digital painting";
  const primaryPrompt = `Create a single album cover image. Theme: "${concept.topic}". Genre: ${concept.genre.join(", ")}. Style: ${styleInstruction}. Visual only, no text or letters in the image.`;
  const attemptGeneration = async (promptText: string, useImageConfig = true) => {
    return await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: promptText,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
      },
    });
  };
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
  try {
    let response: Awaited<ReturnType<typeof attemptGeneration>>;
    try {
      response = await attemptGeneration(primaryPrompt, true);
    } catch {
      response = await attemptGeneration(primaryPrompt, false);
    }
    let dataUrl = extractImageFromResponse(response);
    if (!dataUrl) {
      const fallbackPrompt = `Abstract album artwork, mood: ${(concept.mood || []).join(", ")}, vibrant colors, ${styleInstruction}, no text.`;
      response = await attemptGeneration(fallbackPrompt, false);
      dataUrl = extractImageFromResponse(response);
    }
    if (dataUrl) return dataUrl;
    console.warn("Cover art: no image in response", response);
  } catch (err) {
    console.error("Cover art generation error:", err);
  }
  throw new Error("Das Bild konnte nicht generiert werden. Bitte versuche ein neutraleres Thema.");
};
