import { randomInt } from 'crypto';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.<>?';

export interface GenerateOptions {
  length: number;
  includeSymbols: boolean;
}

export function generatePassword(options: GenerateOptions): string {
  const length = Math.max(8, Math.min(128, options.length));
  let alphabet = LOWER + UPPER + DIGITS;
  if (options.includeSymbols) {
    alphabet += SYMBOLS;
  }

  // Ensure at least one of each required class
  const required: string[] = [
    LOWER[randomInt(LOWER.length)]!,
    UPPER[randomInt(UPPER.length)]!,
    DIGITS[randomInt(DIGITS.length)]!,
  ];
  if (options.includeSymbols) {
    required.push(SYMBOLS[randomInt(SYMBOLS.length)]!);
  }

  const chars: string[] = [...required];
  while (chars.length < length) {
    chars.push(alphabet[randomInt(alphabet.length)]!);
  }

  // Fisher–Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join('');
}
