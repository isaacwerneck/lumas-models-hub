import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatBrl, parseMoneyInput } from "../lib/money";
import type { MoneyCurrency } from "../lib/money";
import type { FxRateResponse } from "../types/api";

type MoneyFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  currency: MoneyCurrency;
  onCurrencyChange: (currency: MoneyCurrency) => void;
  confidence: number | null;
  reading?: boolean;
};

export const MoneyField = ({
  value,
  onValueChange,
  currency,
  onCurrencyChange,
  confidence,
  reading = false
}: MoneyFieldProps) => {
  const [fxRate, setFxRate] = useState<number | null>(null);

  const loadFxRate = useCallback(async () => {
    if (fxRate !== null) {
      return fxRate;
    }
    const response = await api.get<FxRateResponse>("/fx/usd-brl");
    const rate = Number(response.data.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Cotacao USD/BRL invalida no momento.");
    }
    setFxRate(rate);
    return rate;
  }, [fxRate]);

  useEffect(() => {
    if (currency !== "USD" || parseMoneyInput(value) === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      loadFxRate().catch(() => {
        // cotacao indisponivel: apenas nao exibe o preview
      });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [value, currency, loadFxRate]);

  const usdValue = currency === "USD" ? parseMoneyInput(value) : null;
  const preview =
    usdValue !== null && fxRate !== null
      ? `${formatBrl(usdValue * fxRate)} (cotacao ${fxRate.toFixed(4)})`
      : null;

  const confidencePct = confidence !== null ? Math.round(confidence * 100) : null;
  const lowConfidence = confidence !== null && confidence < 0.7;

  return (
    <div className="money-field">
      <div className="field-row">
        <span className="field-label">Valor do faturamento</span>
        <div className="segmented" role="group" aria-label="Moeda do valor">
          <button
            type="button"
            className={currency === "BRL" ? "active" : ""}
            aria-pressed={currency === "BRL"}
            onClick={() => onCurrencyChange("BRL")}
          >
            R$
          </button>
          <button
            type="button"
            className={currency === "USD" ? "active" : ""}
            aria-pressed={currency === "USD"}
            onClick={() => onCurrencyChange("USD")}
          >
            US$
          </button>
        </div>
      </div>

      <div className="field-row">
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={currency === "BRL" ? "R$ 1.234,56" : "ex: 250.00"}
          inputMode="decimal"
          autoComplete="off"
          aria-label="Valor do faturamento"
        />
        {reading ? <span className="ocr-chip">Lendo OCR…</span> : null}
        {!reading && confidencePct !== null ? (
          <span className={`ocr-chip ${lowConfidence ? "ocr-warning" : ""}`}>OCR {confidencePct}%</span>
        ) : null}
      </div>

      {lowConfidence ? (
        <small className="ocr-warning-hint">
          Confiança baixa do OCR — confira o valor lido antes de continuar.
        </small>
      ) : null}

      {preview ? <small className="fx-hint">≈ {preview}</small> : null}
    </div>
  );
};
