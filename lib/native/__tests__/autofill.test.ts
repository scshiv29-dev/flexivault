jest.mock("react-native", () => {
  const reactNative = jest.requireActual("react-native");
  reactNative.NativeModules.FlexiVaultAutofill = {
    clearAllPendingSaves: jest.fn(),
    clearPendingSaves: jest.fn(),
    readPendingSaves: jest.fn(),
  };
  reactNative.Platform.OS = "android";
  return reactNative;
});

import { NativeModules } from "react-native";

import {
  clearAllPendingAutofillSaves,
  clearPendingAutofillSaves,
} from "../autofill";

const native = NativeModules.FlexiVaultAutofill;

describe("pending autofill cleanup", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    native.clearAllPendingSaves.mockResolvedValue(null);
    native.clearPendingSaves.mockResolvedValue(null);
  });

  it("clears all native entries without reading or parsing credentials", async () => {
    native.readPendingSaves.mockRejectedValue(new Error("Unreadable queue"));

    await clearAllPendingAutofillSaves();

    expect(native.clearAllPendingSaves).toHaveBeenCalledWith();
    expect(native.readPendingSaves).not.toHaveBeenCalled();
    expect(native.clearPendingSaves).not.toHaveBeenCalled();
  });

  it("reports durable deletion failures instead of claiming reset succeeded", async () => {
    const error = new Error("Could not persist removal");
    native.clearAllPendingSaves.mockRejectedValue(error);

    await expect(clearAllPendingAutofillSaves()).rejects.toBe(error);
  });

  it("keeps imported-row cleanup separate from full reset", async () => {
    await clearPendingAutofillSaves(["item_imported"]);

    expect(native.clearPendingSaves).toHaveBeenCalledWith(["item_imported"]);
    expect(native.clearAllPendingSaves).not.toHaveBeenCalled();
  });

  it("does not turn empty imported-row cleanup into full deletion", async () => {
    await clearPendingAutofillSaves([]);

    expect(native.clearPendingSaves).not.toHaveBeenCalled();
    expect(native.clearAllPendingSaves).not.toHaveBeenCalled();
  });
});
