import os

temp = os.environ.get("TEMP")
path = os.path.join(temp, "eff_large_wordlist.txt")
with open(path, encoding="utf-8") as handle:
    lines = handle.read().splitlines()

words = [line.split("\t")[1] for line in lines if "\t" in line]
header = """/**
 * EFF large Diceware word list (7,776 words).
 * https://www.eff.org/dice - CC BY 3.0
 * Each word represents log2(7776) = 12.925 bits of entropy.
 */
export const DICEWARE_WORDS: string[] = [
"""
body = ",\n".join('  "%s"' % word for word in words)
os.makedirs(os.path.join("lib", "vault"), exist_ok=True)
with open(os.path.join("lib", "vault", "words.ts"), "w", encoding="utf-8", newline="\n") as handle:
    handle.write(header + body + "\n];\n")

print(f"wrote {len(words)} words")
