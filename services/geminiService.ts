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
• Präzise Besetzung: Definiere Instrumente exakt (z. B. Rhodes Piano, Upright Bass, Wurlitzer, Electric Guitar) statt allgemeiner Gruppen wie „Piano“ oder „Brass“. Trompete/Brass nur bei brass-affinem Genre (Jazz, Brass Band, Latin Brass).
• Raumklang: Gib Anweisungen zur Mikrofonierung und Akustik (z. B. close-miking, dry, plate reverb, concert hall ambiance).

4. Struktur- & Regieanweisungen (Lyrics-Feld) – KRITISCH FÜR SUNO
• Nur in eckige Klammern [ ]: Alle Anweisungen, Erklärungen, Sektions-Tags und instrumentale Regie. Beispiele: [Intro], [Verse], [Chorus], [Bridge], [Outro], [Syncopated bassline, ghost notes on snare], [Sforzando-Piano]. Suno interpretiert alles in [ ] NICHT als Gesang.
• Nur OHNE eckige Klammern: Die reinen, zu singenden Lyrics. Jede Zeile ohne [ ] wird von Suno als gesungener Text behandelt. Keine Regie, keine Erklärungen außerhalb von Klammern – nur der tatsächliche Songtext.

5. Kompression & Limitierung (App-Logik)
• Zeichen-Management: Halte den Style-Prompt unter 200 Zeichen (Suno V5 erlaubt max. 1000, empfohlen 80–200 für Fokus).
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
- **Strukturierung:** Nutze präzise Regieanweisungen ausschließlich in eckigen Klammern (z.B. [Bridge], [Outro], [Sforzando-Piano]). Reine Lyrics stehen immer ohne Klammern.
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
    contents: `Analyse für Suno V5 – oberste Priorität: Qualität und KONSISTENZ über alle Schritte (Konzept → Lyrics → Style). Thema: "${topic}".${instrumentalNote}
- Liefer genre, mood, tempo und präzise instrumentation (spezifische Instrumente, keine vagen Oberbegriffe). Instrumentation OHNE Trompete/Brass/Bläser, außer das Genre verlangt es (z. B. Jazz, Brass Band, Latin Brass).
- vocals: Gib für jede Gesangsstimme einen EINDEUTIGEN Vornamen oder Künstlernamen, der in Lyrics und Style EXAKT so übernommen wird (z. B. ["Herrmann (Bariton)"] oder Duett ["Herrmann (Bariton)", "Sonja (Sopran)"]). Dieser Name ist verbindlich – in den folgenden Schritten (Lyrics, Style) darf kein anderer Name verwendet oder erfunden werden.
- Falls das Thema einen Künstler referenziert (z. B. "wie Michael Jackson"), kann dieser Vorname (Michael) als vocals-Name genutzt werden; ansonsten wähle einen passenden, eindeutigen Namen.`,
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
  const vocalsBinding = (concept.vocals && concept.vocals.length > 0)
    ? `\n- KONSISTENZ VOKALNAMEN (PFLICHT): Im Konzept sind folgende Stimmen festgelegt: ${JSON.stringify(concept.vocals)}. Extrahiere daraus den/die exakten Namen (z. B. Herrmann, Sonja). Verwende in ALLEN Regie-Tags NUR diese Namen: zu Beginn [Name: Male/Female. Bariton/Sopran, ...], dann [Verse 1: Name], [Chorus: Name]. Erfinde KEINE anderen Namen (kein Klaus, Manfred, Sonja etc., außer sie stehen explizit im Konzept).\n`
    : "";
const noBrassNote = `\n- KEINE Trompete/Brass/Bläser (kein tpt, trumpet, horns, brass) in den Regie-Tags, außer das Genre verlangt es ausdrücklich (z. B. Jazz, Brass Band, Latin Brass). Für Pop, Rock, Ballade, Indie, Lo-Fi, Singer-Songwriter etc. nur Rhythmusgruppe, Piano, Gitarre, Strings – kein Brass.\n`;

  const prompt = concept.isInstrumental
    ? `[SEED: ${salt}] Instrumental-Struktur für Suno V5. Thema: ${concept.topic}. Genre: ${genreStr}.
- Erzeuge nur eine Abfolge von Regie-Tags in eckigen Klammern, z. B. [Intro], [Verse], [Chorus], [Bridge], [Solo], [Outro].
- In jedes Tag gehören präzise Spielanweisungen für die Begleitung, z. B.:
  [Intro · Rhodes pno, upright bass, soft brush dr, close-miked, dry room]
  [Verse · muted electric gtr, syncopated bassline mit ghost notes, tight rimshot snare]
  [Bridge · Wurlitzer pno, pad strings, plate reverb]
- Nutze exakte Instrumentennamen (Rhodes Piano, Upright Bass, Gitarre, Keys, Drums), Artikulation (staccato, legato, marcato, muted, pizzicato) und Raumklang (close-miking, dry, plate reverb).${noBrassNote}- Kein gesungener Text, NUR Struktur und Regie in [ ].`
    : `[SEED: ${salt}] Erstelle einen absolut neuen, einzigartigen Songtext auf höchstem professionellen Niveau.
- Thema: ${concept.topic}. Sprache: ${langStr}. Genre: ${genreStr}. Mood: ${(concept.mood || []).join(", ")}.${vocalsBinding}- Vermeide Kitsch, Klischees und banale Bilder (kein einfacher Herz/Schmerz). Nutze originelle, narrativ starke Metaphern.
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
- VERBOTEN:
  · Keine Einleitungen wie \"Hier ist dein Song\" oder Erklär-Absätze.
  · Keine Markdown-Überschriften (kein ### 1./2.).
  · Keine anderen Vokalnamen als die aus dem Konzept.
- Die erste Zeile der Antwort ist direkt entweder ein Regie-Tag [Intro] oder die erste gesungene Zeile (ohne Klammern).${noBrassNote}`;

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

WICHTIG: Die erste Zeile der Antwort muss direkt der Inhalt sein (kein „Hier ist…“, keine Überschrift). Jede Zeile ohne [ ] muss exakt gleich bleiben.`;

  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Eingabe (nur Regie in [ ] anreichern, Rest unverändert):\n\n${lyrics}`,
    config: { systemInstruction: SYSTEM_INSTRUCTION + "\n\nBei dieser Aufgabe: Antworte NUR mit dem angereicherten Songtext. Keine Einleitung, keine Erklärung. Erste Zeile = erste Zeile des Songs.", temperature: 0.4, ...DEFAULT_THINKING },
  });
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

export const generateStylePrompt = async (
  concept: SongConcept,
  lang: 'de' | 'en' = 'de',
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
  let accumulated = "";
  const stream = await ai.models.generateContentStream({
    model: TEXT_MODEL,
    contents: `Suno V5 Style Context: ${concept.topic}. Genre: ${concept.genre.join(", ")}.${regieBlock}
- Aufgabe: Erzeuge einen extrem kompakten, hochpräzisen Style-Prompt für eine Musik-KI wie Suno.

- SPRACHE – UNBEDINGT BEACHTEN:
  · Das Feld \"prompt\" (Suno Style-Prompt) MUSS ausschließlich auf ENGLISCH formuliert sein. Nur englische Begriffe (z. B. BPM, instrumentation, feel). Dieses Feld wird von der App nicht übersetzt.
  · Die Felder promptEffect, recommendationReason und songDescription MÜSSEN ausschließlich auf DEUTSCH formuliert sein (Wirkung & Technik, Warum diese Empfehlung, Song-Story). Diese Texte können in der App per Sprachumschalter angezeigt werden.

- DER STYLE-PROMPT (Feld \"prompt\" im JSON, nur Englisch):
  · Ziel: 80–200 Zeichen (kompakt und fokussiert). Suno V5 erlaubt bis zu 1000 Zeichen, aber kürzere Prompts erzeugen bessere Ergebnisse. Halte den Prompt unter ${MAX_STYLE_PROMPT_LENGTH} Zeichen.
  · Immer eine konkrete BPM-Zahl (z. B. 125 BPM), ein klares Feel (swing, straight, halftime).
  · Wichtige Instrumentierung und Artikulation (z. B. Rhodes pno, upright bass, marcato brass, tight drums). Musiker-Abkürzungen erlaubt (tpt, sax, pno, dr).
  · Exaktes musikalisches Vokabular (minor 9th chords, syncopated slap bass, ghost notes, close-miked, plate reverb).

- Zusätzlich zurückgeben (Safe Zone – Werte MÜSSEN zwischen 15 und 85 liegen):
  · promptEffect: Auf DEUTSCH – wie wirkt dieser Prompt musikalisch (Harmonik, Groove, Artikulation).
  · similarArtists: Passende Künstler-Referenzen, kommagetrennt (Künstlernamen können englisch bleiben).
  · weirdness: Ganzzahl 15–85 (Originalität/Kreativität). styleInfluence: Ganzzahl 15–85 (Prompt-Treue).
  · recommendationReason: Auf DEUTSCH – 2–4 Sätze, warum genau diese Werte für diesen Song (Thema, Genre, Stimmung), keine Floskeln.
  · songDescription: Auf DEUTSCH – kurze Beschreibung des Songs/Vibes für Cover-Art und Story.
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
    if (stylePrompt.length > SUNO_HARD_LIMIT) {
      stylePrompt = stylePrompt.slice(0, SUNO_HARD_LIMIT);
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

/** Style-Prompt anreichern: präzisere Instrumentierung, Artikulation, BPM/Feel hinzufügen. */
export const enrichStylePrompt = async (prompt: string, concept: SongConcept): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Kein API Key gefunden.");
  const ai = new GoogleGenAI({ apiKey });
  const noBrass = concept.genre.some(g => /jazz|brass|latin|barock/i.test(g))
    ? ""
    : " No trumpet/brass/horns unless the genre demands it.";
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Current Suno V5 style prompt: "${prompt}"
Genre context: ${concept.genre.join(", ")}. Topic: "${concept.topic}".

Task: Enrich this style prompt for Suno V5. Make it more specific and professional:
- Add precise BPM and feel if missing (e.g. "118 BPM, halftime feel").
- Add specific instruments (e.g. Rhodes pno, upright bass, tight brush drums) instead of vague terms.
- Add articulation cues (staccato, legato, muted, fingerpicked).
- Add production/room characteristics (close-miked, dry, plate reverb, tape warmth).${noBrass}
- Keep it ENGLISH ONLY, concise (target 80–200 chars, max 300), and purely descriptive (no lyrics).
- Return ONLY the enriched prompt text, nothing else.`,
    config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.5, ...DEFAULT_THINKING },
  });
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
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Genres to fuse: ${genres.join(" + ")}
Topic context: "${concept.topic || 'not set yet'}"
Current mood: ${concept.mood.length ? concept.mood.join(', ') : 'not set'}

Create a unique genre fusion from these genres. Think like a visionary producer who blends styles in unexpected ways.`,
    config: {
      systemInstruction: `You are a genre-fusion specialist for Suno V5 music production. Your task is to take 2+ genres and create a unique, cohesive fusion.

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
  });
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
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: `Current concept:
- Topic: "${concept.topic || 'not set'}"
- Genres: ${concept.genre.length ? concept.genre.join(', ') : 'none'}
- Mood: ${concept.mood.length ? concept.mood.join(', ') : 'none'}
- Tempo: ${concept.tempo.length ? concept.tempo.join(', ') : 'none'}
- Instruments: ${concept.instrumentation?.length ? concept.instrumentation.join(', ') : 'none'}
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
- Keep suggestions Suno V5 compatible`,
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
  });
  return JSON.parse(response.text || "{}");
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
  const noTextInstruction = "CRITICAL: The image must contain ZERO text: no letters, no words, no numbers, no logos, no titles, no writing of any kind. Purely visual artwork only.";
  const primaryPrompt = `Create a single album cover image. Theme: "${concept.topic}". Genre: ${concept.genre.join(", ")}. Style: ${styleInstruction}. ${noTextInstruction}`;
  const attemptGeneration = async (promptText: string, useImageConfig = false, modelId?: string) => {
    return await ai.models.generateContent({
      model: modelId || IMAGE_MODEL,
      contents: promptText,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: useImageConfig ? { aspectRatio: "1:1", imageSize: "1K" } : undefined,
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
  const FALLBACK_IMAGE_MODEL = "gemini-2.0-flash-exp";
  const freeTierHint = " Kostenloser Key (aistudio.google.com): Tageslimit ca. 500 Bilder; Key dort erstellen und hier eintragen.";
  try {
    let response: Awaited<ReturnType<typeof attemptGeneration>>;
    // Free-Tier: Zuerst minimaler Aufruf ohne imageConfig (beste Kompatibilität mit kostenlosem API-Key)
    try {
      response = await attemptGeneration(primaryPrompt, false);
    } catch (e1) {
      try {
        response = await attemptGeneration(primaryPrompt, true);
      } catch (e2) {
        try {
          response = await attemptGeneration(primaryPrompt, false, FALLBACK_IMAGE_MODEL);
        } catch (e3) {
          console.warn("Cover art attempts failed:", { e1, e2, e3 });
          throw e1;
        }
      }
    }
    let dataUrl = extractImageFromResponse(response);
    if (!dataUrl) {
      const fallbackPrompt = `Abstract album artwork, mood: ${(concept.mood || []).join(", ")}, vibrant colors, ${styleInstruction}. ${noTextInstruction}`;
      try {
        response = await attemptGeneration(fallbackPrompt, false);
        dataUrl = extractImageFromResponse(response);
      } catch {
        try {
          response = await attemptGeneration(fallbackPrompt, false, FALLBACK_IMAGE_MODEL);
          dataUrl = extractImageFromResponse(response);
        } catch {
          // keep dataUrl null
        }
      }
    }
    if (dataUrl) return dataUrl;
    console.warn("Cover art: no image in response", response);
  } catch (err: unknown) {
    console.error("Cover art generation error:", err);
    const msg = err instanceof Error ? err.message : String(err);
    const isBillingOrQuota = /billing|429|quota|resource_exhausted|403|not supported|not available/i.test(msg);
    if (isBillingOrQuota) {
      throw new Error("Bildgenerierung fehlgeschlagen (Limit oder Berechtigung)." + freeTierHint);
    }
    throw new Error("Bildgenerierung fehlgeschlagen: " + (msg.slice(0, 80) || "Unbekannter Fehler") + "." + freeTierHint);
  }
  throw new Error("Das Bild konnte nicht generiert werden." + freeTierHint);
};
