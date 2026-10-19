import {
  isMigrationUrl,
  isOtpAuthUrl,
  otpToTotpConfig,
  parseOtpAuthUrl,
} from "../otpauth";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("otpauth URLs", () => {
  it("parses encoded issuer and label parameters", () => {
    const parsed = parseOtpAuthUrl(
      `otpauth://totp/ACME%20Co:john.doe@email.com?secret=${SECRET}` +
        "&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60"
    );

    expect(parsed).toEqual({
      type: "totp",
      issuer: "ACME Co",
      label: "john.doe@email.com",
      secret: SECRET,
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
  });

  it("tolerates an unencoded colon and padded lowercase secret", () => {
    const parsed = parseOtpAuthUrl(
      "otpauth://totp/Example:alice@example.com?secret=jbswy3dpehpk3pxp===="
    );
    expect(parsed.issuer).toBe("Example");
    expect(parsed.label).toBe("alice@example.com");
    expect(parsed.secret).toBe(SECRET);
    expect(parsed.algorithm).toBe("SHA1");
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
  });

  it("falls back to the issuer parameter when the label has no prefix", () => {
    const parsed = parseOtpAuthUrl(
      `otpauth://totp/alice@example.com?secret=${SECRET}&issuer=Example`
    );
    expect(parsed.issuer).toBe("Example");
    expect(parsed.label).toBe("alice@example.com");
  });

  it("maps a parsed entry onto a TotpConfig", () => {
    const parsed = parseOtpAuthUrl(
      `otpauth://totp/Example:alice?secret=${SECRET}&digits=7`
    );
    expect(otpToTotpConfig(parsed)).toEqual({
      secret: SECRET,
      algorithm: "SHA1",
      digits: 7,
      period: 30,
      issuer: "Example",
      label: "alice",
    });
  });

  it("rejects malformed, hotp and secret-less URLs", () => {
    expect(() => parseOtpAuthUrl("https://example.com")).toThrow("Not an otpauth URL");
    expect(() =>
      parseOtpAuthUrl(`otpauth://hotp/Example:alice?secret=${SECRET}&counter=1`)
    ).toThrow(/time-based/i);
    expect(() => parseOtpAuthUrl("otpauth://totp/Example:alice")).toThrow(/secret/i);
    expect(() =>
      parseOtpAuthUrl("otpauth://totp/Example:alice?secret=not-base32!")
    ).toThrow(/base32/i);
  });

  it("recognises scheme prefixes", () => {
    expect(isOtpAuthUrl(` otpauth://totp/a?secret=${SECRET}`)).toBe(true);
    expect(isOtpAuthUrl("https://example.com")).toBe(false);
    expect(isMigrationUrl("otpauth-migration://offline?data=abc")).toBe(true);
    expect(isMigrationUrl("otpauth://totp/a")).toBe(false);
  });
});
