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
  const matches = rawText.match(/(?:R\$\s*)?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|(?:R\$\s*)?\d+[.,]\d{2}/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => match.trim());
};

export const findFirstCurrencyCandidate = (rawText: string): { value: string; cents: number } | null => {
  for (const value of extractCurrencyCandidatesFromText(rawText)) {
    const cents = brlStringToCents(value);
    if (cents !== null && cents >= 0) {
      return { value, cents };
    }
  }

  return null;
};

const normalizeForSearch = (value: string) => {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
};

const normalizeForTokenSearch = (value: string) => {
  return normalizeForSearch(value).replace(/[^a-z0-9]/g, "");
};

const toBrlLikeStringFromToken = (token: string): string | null => {
  const normalizedToken = token
    .replace(/[oO]/g, "0")
    .replace(/[sS]/g, "5")
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!normalizedToken) {
    return null;
  }

  const digitsOnly = normalizedToken.replace(/\D/g, "");
  if (!digitsOnly) {
    return null;
  }

  if (/^0+$/.test(digitsOnly)) {
    return null;
  }

  const hasComma = normalizedToken.includes(",");
  const hasDot = normalizedToken.includes(".");

  if (hasComma || hasDot) {
    const lastComma = normalizedToken.lastIndexOf(",");
    const lastDot = normalizedToken.lastIndexOf(".");
    const separatorIndex = Math.max(lastComma, lastDot);
    const decimalsRaw = normalizedToken.slice(separatorIndex + 1).replace(/\D/g, "");
    const integerRaw = normalizedToken.slice(0, separatorIndex).replace(/\D/g, "");

    if (integerRaw.length > 0 && decimalsRaw.length >= 2) {
      const value = `${Number(integerRaw)},${decimalsRaw.slice(0, 2)}`;
      const cents = brlStringToCents(value);
      return cents !== null && cents > 0 ? value : null;
    }
  }

  // Heuristic for OCR without separator: 67029 => 670,29.
  if (digitsOnly.length >= 4) {
    const value = `${Number(digitsOnly.slice(0, -2))},${digitsOnly.slice(-2)}`;
    const cents = brlStringToCents(value);
    return cents !== null && cents > 0 ? value : null;
  }

  return null;
};

const extractLooseNumericToken = (line: string): string | null => {
  const candidates = line.match(/(?:R\$\s*)?[\dOoSs][\dOoSs\s.,-]{1,20}/g);
  if (!candidates) {
    return null;
  }

  for (const candidate of candidates) {
    const brlLike = toBrlLikeStringFromToken(candidate);
    if (brlLike) {
      return brlLike;
    }
  }

  return null;
};

const inferDecimalValueFromPlainDigits = (line: string): string | null => {
  const match = line.match(/(?:r\$\s*)?(\d{4,8})\b/i);
  if (!match) {
    return extractLooseNumericToken(line);
  }

  const digits = match[1];
  const integerPart = digits.slice(0, -2);
  const decimalPart = digits.slice(-2);

  if (!integerPart.length) {
    return null;
  }

  const value = `${integerPart},${decimalPart}`;
  const cents = brlStringToCents(value);
  return cents !== null && cents > 0 ? value : null;
};

const extractStrictCurrencyFromLine = (line: string): string | null => {
  const candidates = extractCurrencyCandidatesFromText(line);
  if (!candidates.length) {
    return null;
  }

  for (const candidate of candidates) {
    const cents = brlStringToCents(candidate);
    if (cents !== null && cents > 0) {
      return candidate;
    }
  }

  return null;
};

const extractLooseCurrencyFromLine = (line: string): string | null => {
  return inferDecimalValueFromPlainDigits(line);
};

const isFaturamentoAnchorLine = (line: string) => {
  const token = normalizeForTokenSearch(line);
  if (!token) {
    return false;
  }

  if (
    token.includes("faturamento") ||
    token.includes("faturado") ||
    token.includes("faturam") ||
    token.includes("fatura")
  ) {
    return true;
  }

  // Fuzzy fallback for common OCR distortions around "faturamento".
  return /f[a-z0-9]{0,4}t[a-z0-9]{0,4}r[a-z0-9]{0,6}m/.test(token);
};

const isHojeAnchorLine = (line: string) => {
  const token = normalizeForTokenSearch(line);
  return token.includes("hoje");
};

const isSectionBoundaryLine = (line: string) => {
  const token = normalizeForTokenSearch(line);
  return (
    token.includes("liberado") ||
    token.includes("total") ||
    token.includes("sacar") ||
    token.includes("notificacao") ||
    token.includes("modoescuro")
  );
};

export const extractFaturadoValueFromText = (rawText: string): string | null => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return null;
  }

  const tryFindFromAnchor = (mode: "faturamento" | "hoje", strategy: "strict" | "loose") => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const isAnchor = mode === "faturamento" ? isFaturamentoAnchorLine(line) : isHojeAnchorLine(line);
      if (!isAnchor) {
        continue;
      }

      const lookAhead = mode === "faturamento" ? 7 : 3;
      const extract = strategy === "strict" ? extractStrictCurrencyFromLine : extractLooseCurrencyFromLine;

      const sameLineValue = extract(line);
      if (sameLineValue) {
        return sameLineValue;
      }

      for (let next = index + 1; next <= Math.min(index + lookAhead, lines.length - 1); next += 1) {
        const nextLine = lines[next];
        if (next > index + 1 && isSectionBoundaryLine(nextLine)) {
          break;
        }

        const nextValue = extract(nextLine);
        if (nextValue) {
          return nextValue;
        }
      }
    }

    return null;
  };

  return (
    tryFindFromAnchor("faturamento", "strict") ??
    tryFindFromAnchor("faturamento", "loose") ??
    tryFindFromAnchor("hoje", "strict") ??
    tryFindFromAnchor("hoje", "loose")
  );
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

  const faturadoValue = extractFaturadoValueFromText(params.rawText);
  if (faturadoValue) {
    const parsed = brlStringToCents(faturadoValue);
    if (parsed !== null) {
      return parsed;
    }
  }

  // O dashboard apresenta Faturamento, Liberado e Total da esquerda para a direita.
  // O Tesseract mantém essa ordem no texto, portanto o primeiro valor é o faturamento.
  return findFirstCurrencyCandidate(params.rawText)?.cents ?? null;
};

export const centsToBrl = (cents: number): string => {
  const value = cents / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
};
