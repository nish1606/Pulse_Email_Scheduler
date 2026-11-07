export function parseEmailsFromText(text: string): string[] {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((e) => e.toLowerCase())));
}

export async function parseEmailFile(file: File): Promise<string[]> {
  const text = await file.text();
  return parseEmailsFromText(text);
}
