import {
  base32Decode,
  base32Encode,
  formatTotpCode,
  generateHotp,
  generateTotp,
  isValidBase32,
  legacySecretToBase32,
  secondsRemaining,
  totpProgress,
} from "../otp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 128, 64, 32, 16, 8]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("accepts lowercase, spaces and padding", () => {
    expect(isValidBase32("jbsw y3dp ehpk 3pxp")).toBe(true);
    expect(base32Decode("JBSWY3DPEHPK3PXP")).toHaveLength(10);
  });

  it("rejects invalid characters", () => {
    expect(isValidBase32("JBSWY3DP1HPK3PXP")).toBe(false);
    expect(() => base32Decode("JBSWY3DP1HPK3PXP")).toThrow();
  });

  it("converts the legacy JSON byte secret", () => {
    const legacy = JSON.stringify(
      Array.from("12345678901234567890").map((character) => character.charCodeAt(0))
    );
    expect(legacySecretToBase32(legacy)).toBe(RFC_SECRET);
  });
});

describe("HOTP", () => {
  // RFC 4226 appendix D.
  const vectors = [
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ] as const;

  it.each(vectors)("counter %i produces %s", (counter, expected) => {
    expect(generateHotp(RFC_SECRET, counter)).toBe(expected);
  });
});

describe("TOTP", () => {
  // RFC 6238 appendix B (SHA-1, 8 digits).
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const;

  it.each(vectors)("timestamp %i produces %s", (timestamp, expected) => {
    expect(
      generateTotp(
        { secret: RFC_SECRET, algorithm: "SHA1", digits: 8, period: 30 },
        timestamp * 1000
      )
    ).toBe(expected);
  });

  it("defaults to six digits, SHA-1 and 30 seconds", () => {
    expect(
      generateTotp(
        { secret: RFC_SECRET, algorithm: "SHA1", digits: 6, period: 30 },
        59_000
      )
    ).toBe("287082");
  });

  it("counts down inside the current window", () => {
    expect(secondsRemaining(30, 59_000)).toBe(1);
    expect(secondsRemaining(30, 60_000)).toBe(30);
    expect(totpProgress(30, 75_000)).toBeCloseTo(0.5);
  });

  it("formats codes in groups of three", () => {
    expect(formatTotpCode("123456")).toBe("123 456");
    expect(formatTotpCode("12345678")).toBe("123 456 78");
    expect(formatTotpCode("")).toBe("");
  });
});
