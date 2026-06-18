import { beforeEach, describe, expect, it } from "vitest";
import { appDataStorageKeys } from "./appDataStorage";
import { getLocalRecovery, restoreLocalRecovery, saveLocalRecovery } from "./dataRecovery";

describe("dataRecovery", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("restores every managed storage key to its previous value", () => {
    appDataStorageKeys.forEach((key, index) => localStorage.setItem(key, `before-${index}`));
    saveLocalRecovery("delete");
    appDataStorageKeys.forEach((key, index) => localStorage.setItem(key, `after-${index}`));

    expect(restoreLocalRecovery()).toBe(true);
    appDataStorageKeys.forEach((key, index) => {
      expect(localStorage.getItem(key)).toBe(`before-${index}`);
    });
    expect(getLocalRecovery()).toBeNull();
  });

  it("restores keys that were absent by removing newly created values", () => {
    saveLocalRecovery("restore");
    localStorage.setItem(appDataStorageKeys[0], "created later");

    restoreLocalRecovery();

    expect(localStorage.getItem(appDataStorageKeys[0])).toBeNull();
  });

  it("discards a corrupted recovery record", () => {
    localStorage.setItem("dont-forget-local-recovery", "{broken");

    expect(getLocalRecovery()).toBeNull();
  });
});
