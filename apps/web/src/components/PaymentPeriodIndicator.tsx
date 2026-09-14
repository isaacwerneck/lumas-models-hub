import { CalendarDays } from "lucide-react";
import type { PaymentPeriod } from "@lumas/contracts";
import { formatDateKeyShort } from "../lib/dateTime";

type Props = {
  period: PaymentPeriod;
  amountFormatted?: string;
  referenceOnly?: boolean;
  compact?: boolean;
};

export const PaymentPeriodIndicator = ({ period, amountFormatted, referenceOnly = false, compact = false }: Props) => (
  <div className={`payment-period-indicator${compact ? " is-compact" : ""}`}>
    {!referenceOnly ? <div className="payment-period-date">
      <CalendarDays size={15} aria-hidden="true" />
      <span>Pagamento em <strong>{formatDateKeyShort(period.paymentDate)}</strong></span>
      {amountFormatted ? <strong>{amountFormatted}</strong> : null}
    </div> : null}
    <small>
      Referência: {formatDateKeyShort(period.referenceStart, false)} a {formatDateKeyShort(period.referenceEnd)}
    </small>
  </div>
);
