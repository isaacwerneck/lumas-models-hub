export const brlStringToCents = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const noCurrency = trimmed.replace(/R\$/gi, "").replace(/\s+/g, "");
  const normalized = noCurrency.includes(",")
    ? noCurrency.replace(/\./g, "").replace(",", ".")
    : noCurrency;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
};

export const extractCurrencyCandidatesFromText = (rawText: string): string[] => {
  const matches = rawText.match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}|(?:R\$\s*)?\d+,\d{2}/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => match.trim());
};

export const resolveOcrValueCents = (params: {
  detectedValue?: string;
  rawText?: string;
}): number | null => {
  if (params.detectedValue) {
    return brlStringToCents(params.detectedValue);
  }

  if (!params.rawText) {
    return null;
  }

  const candidates = extractCurrencyCandidatesFromText(params.rawText);
  if (!candidates.length) {
    return null;
  }

  // Prefer the highest parsed value to avoid selecting small unrelated amounts.
  const parsed = candidates
    .map((candidate) => brlStringToCents(candidate))
    .filter((value): value is number => value !== null);

  if (!parsed.length) {
    return null;
  }

  return Math.max(...parsed);
};

export const centsToBrl = (cents: number): string => {
  const value = cents / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
};
