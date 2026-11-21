import { encodeQr } from "../encode";
import { encodeQr as serverEncodeQr } from "../../../server/src/qr.js";

describe("encodeQr", () => {
  it("picks the smallest version and draws finder patterns", () => {
    for (const [text, size] of [
      ["hi", 21],
      ["x".repeat(150), 49],
      ["z".repeat(1200), 133],
    ] as const) {
      const m = encodeQr(text);
      expect(m).toHaveLength(size);
      expect(m[0].slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
      expect(m[3].slice(0, 7)).toEqual([true, false, true, true, true, false, true]);
      expect(m[size - 8][8]).toBe(true);
    }
  });

  it("matches the server encoder bit for bit", () => {
    for (const text of [
      "flexivault://connect?server=https%3A%2F%2Fvault.example.com&email=a%40b.co",
      "ünïcødé ✓ " + "y".repeat(300),
    ]) {
      expect(encodeQr(text)).toEqual(serverEncodeQr(text));
    }
  });
});
