export type MobileMoneyProvider = 'mtn' | 'vod' | 'tgo';

const PROVIDER_ALIASES: Record<string, MobileMoneyProvider> = {
  mtn: 'mtn',
  vod: 'vod',
  vodafone: 'vod',
  telecel: 'vod',
  tgo: 'tgo',
  tigo: 'tgo',
  airtel: 'tgo',
  airteltigo: 'tgo',
  at: 'tgo',
};

export function normalizeMobileMoneyProvider(raw: string): MobileMoneyProvider | undefined {
  return PROVIDER_ALIASES[raw.trim().toLowerCase()];
}

export function normalizeGhanaPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length >= 12) {
    digits = `0${digits.slice(3)}`;
  } else if (digits.length === 9 && !digits.startsWith('0')) {
    digits = `0${digits}`;
  }
  return digits;
}

interface PaymentInstructionLike {
  channel: string;
  action: string;
  display_text?: string;
  provider?: string;
  phone?: string;
  authorization_url?: string;
}

interface PaymentSessionLike {
  order_id?: string;
  reference?: string;
  channel?: string;
  payment_status?: string;
  message?: string;
  instruction?: PaymentInstructionLike;
}

/** Markdown summary so agents surface Paystack display_text to the buyer. */
export function formatPaymentSessionMarkdown(session: PaymentSessionLike): string {
  const lines: string[] = ['## Payment session', ''];

  if (session.payment_status) {
    lines.push(`**Status:** ${session.payment_status}`);
  }
  if (session.reference) {
    lines.push(`**Reference:** ${session.reference}`);
  }
  if (session.message) {
    lines.push(`**Message:** ${session.message}`);
  }

  const inst = session.instruction;
  if (inst) {
    lines.push('', `**Action:** \`${inst.action}\``);
    if (inst.channel === 'mobile_money') {
      if (inst.provider) lines.push(`**Provider:** ${inst.provider}`);
      if (inst.phone) lines.push(`**Phone:** ${inst.phone}`);
    }
    if (inst.display_text) {
      lines.push(
        '',
        '**Show this instruction to the buyer (from Paystack):**',
        '',
        inst.display_text,
      );
    }
    if (inst.action === 'redirect' && inst.authorization_url) {
      lines.push('', `**Payment link:** ${inst.authorization_url}`);
    }
  }

  lines.push('', '<details><summary>Raw JSON</summary>', '', '```json', JSON.stringify(session, null, 2), '```', '</details>');
  return lines.join('\n');
}
