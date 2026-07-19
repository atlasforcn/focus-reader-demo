const TERMINAL_PUNCTUATION = new Set(["。", "！", "？", "!", "?", ".", "…", ";", "；"]);
const CLOSING_MARKS = new Set(["」", "』", "）", ")", "】", "]", "〉", "》", "”", "’", "\"", "'"]);

/** Split Chinese and mixed-language text without losing punctuation. */
export function splitIntoSentences(input) {
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const sentences = [];
  let buffer = "";
  const flush = () => {
    const sentence = buffer.replace(/\s+/g, " ").trim();
    if (sentence) sentences.push(sentence);
    buffer = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    buffer += character;

    if (character === "\n") {
      flush();
      continue;
    }

    if (!TERMINAL_PUNCTUATION.has(character)) continue;

    while (CLOSING_MARKS.has(text[index + 1])) {
      index += 1;
      buffer += text[index];
    }

    // Keep decimal numbers and common abbreviations together.
    if (character === "." && /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "")) continue;
    if (character === "." && /[A-Za-z]/.test(text[index - 1] ?? "") && /[A-Za-z]/.test(text[index + 1] ?? "")) continue;
    flush();
  }

  flush();
  return sentences;
}
