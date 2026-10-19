import * as Crypto from "expo-crypto";

import { DICEWARE_WORDS } from "./words";

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: true,
};

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 6,
  separator: "-",
  capitalize: true,
};

const SETS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  numbers: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

const AMBIGUOUS = new Set(["O", "0", "o", "I", "l", "1", "|"]);

/** Uniform random integer in [0, max) using rejection sampling. */
export function randomInt(max: number): number {
  if (max <= 0) throw new Error("max must be positive");
  const limit = Math.floor(0xffffffff / max) * max;
  const bytes = Crypto.getRandomBytes(4);
  const value =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  if (value >= limit) return randomInt(max);
  return value % max;
}

function shuffle<T>(values: T[]): T[] {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

export function generatePassword(options: PasswordOptions): string {
  const pools: string[] = [];
  if (options.lowercase) pools.push(SETS.lowercase);
  if (options.uppercase) pools.push(SETS.uppercase);
  if (options.numbers) pools.push(SETS.numbers);
  if (options.symbols) pools.push(SETS.symbols);

  if (pools.length === 0) throw new Error("Select at least one character set");

  const filter = (pool: string) => {
    if (!options.excludeAmbiguous) return pool;
    const filtered = Array.from(pool)
      .filter((char) => !AMBIGUOUS.has(char))
      .join("");
    return filtered || pool;
  };

  const filteredPools = pools.map(filter);
  const all = filter(Array.from(new Set(filteredPools.join(""))).join(""));
  const length = Math.max(options.length, filteredPools.length);

  const characters: string[] = filteredPools.map((pool) => {
    const usable = pool || all;
    return usable[randomInt(usable.length)];
  });

  while (characters.length < length) {
    characters.push(all[randomInt(all.length)]);
  }

  return shuffle(characters).join("");
}

export function generatePassphrase(options: PassphraseOptions): string {
  const words = Math.max(3, Math.min(12, Math.round(options.words)));
  const output: string[] = [];
  for (let index = 0; index < words; index += 1) {
    let word = DICEWARE_WORDS[randomInt(DICEWARE_WORDS.length)];
    if (options.capitalize) word = word[0].toUpperCase() + word.slice(1);
    output.push(word);
  }
  return output.join(options.separator);
}

export interface StrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  entropy: number;
  /** 0..1, suitable for a progress bar. */
  fraction: number;
}

export function estimatePasswordEntropy(password: string): number {
  if (!password) return 0;
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/\d/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;
  if (poolSize === 0) return 0;
  return password.length * Math.log2(poolSize);
}

export function passwordStrength(password: string): StrengthResult {
  const entropy = estimatePasswordEntropy(password);
  let score: StrengthResult["score"] = 0;
  if (entropy >= 100) score = 4;
  else if (entropy >= 75) score = 3;
  else if (entropy >= 50) score = 2;
  else if (entropy >= 30) score = 1;

  const labels = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];
  return {
    score,
    label: labels[score],
    entropy,
    fraction: Math.min(1, entropy / 110),
  };
}

export function passphraseStrength(words: number): StrengthResult {
  const entropy = words * Math.log2(DICEWARE_WORDS.length);
  let score: StrengthResult["score"] = 0;
  if (entropy >= 100) score = 4;
  else if (entropy >= 75) score = 3;
  else if (entropy >= 50) score = 2;
  else if (entropy >= 30) score = 1;
  const labels = ["Very weak", "Weak", "Fair", "Strong", "Excellent"];
  return {
    score,
    label: labels[score],
    entropy,
    fraction: Math.min(1, entropy / 110),
  };
}
