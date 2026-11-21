import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { QrCode } from "../QrCode";

describe("QrCode", () => {
  it("renders the encoded modules as one path", () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<QrCode value="flexivault://connect?server=http%3A%2F%2F10.0.0.2%3A8787" />);
    });
    const json = JSON.stringify(tree!.toJSON());
    expect(json).toContain("M4 4h1v1h-1z");
    expect(json).toContain("QR code");
  });
});
