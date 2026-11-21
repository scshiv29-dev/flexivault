import { buildConnectLink, parseConnectLink } from "../connect-link";

describe("connect links", () => {
  it("round-trips server, email and invite", () => {
    const link = buildConnectLink({
      server: "https://vault.example.com/",
      email: " Ada@Example.com ",
      invite: "family 2026",
    });
    expect(link).toBe(
      "flexivault://connect?server=https%3A%2F%2Fvault.example.com&email=ada%40example.com&invite=family+2026"
    );
    expect(parseConnectLink(link)).toEqual({
      server: "https://vault.example.com",
      email: "ada@example.com",
      invite: "family 2026",
    });
  });

  it("parses links produced by the server connect page", () => {
    expect(
      parseConnectLink("flexivault://connect?server=http%3A%2F%2F192.168.1.5%3A8787")
    ).toEqual({ server: "http://192.168.1.5:8787", email: undefined, invite: undefined });
  });

  it("accepts a plain server address or connect page URL", () => {
    expect(parseConnectLink("https://vault.example.com/connect?email=x")).toEqual({
      server: "https://vault.example.com",
    });
    expect(parseConnectLink("http://10.0.0.2:8787")).toEqual({
      server: "http://10.0.0.2:8787",
    });
  });

  it("rejects unrelated codes", () => {
    expect(parseConnectLink("otpauth://totp/x?secret=ABC")).toBeNull();
    expect(parseConnectLink("flexivault://item/123")).toBeNull();
    expect(parseConnectLink("flexivault://connect?server=javascript%3Aalert(1)")).toBeNull();
    expect(parseConnectLink("")).toBeNull();
  });
});
