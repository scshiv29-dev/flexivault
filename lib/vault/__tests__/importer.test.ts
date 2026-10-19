import { importCsv, importJson, importPasswords } from "../importer";

describe("password import", () => {
  it("imports a Bitwarden CSV with quoted commas and multiline notes", () => {
    const csv = [
      "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
      'Work,1,login,"GitHub, Inc.","Line one\nLine two",,0,https://github.com,octocat@example.com,"pa,ss""word",JBSWY3DPEHPK3PXP',
      "Personal,0,note,Recovery codes,\"one\ntwo\",,0,,,,",
    ].join("\n");

    const preview = importCsv(csv);
    expect(preview.format).toBe("bitwarden-csv");
    expect(preview.skipped).toBe(0);
    expect(preview.drafts).toHaveLength(2);

    expect(preview.drafts[0]).toMatchObject({
      type: "login",
      name: "GitHub, Inc.",
      username: "octocat@example.com",
      password: 'pa,ss"word',
      urls: ["https://github.com"],
      folder: "Work",
      favorite: true,
      notes: "Line one\nLine two",
    });
    expect(preview.drafts[0].totp?.secret).toBe("JBSWY3DPEHPK3PXP");

    expect(preview.drafts[1]).toMatchObject({
      type: "note",
      name: "Recovery codes",
      notes: "one\ntwo",
      folder: "Personal",
    });
  });

  it("imports Chrome and LastPass style headers", () => {
    const chrome = importCsv(
      "name,url,username,password,note\nExample,https://example.com,me@example.com,hunter2,hello"
    );
    expect(chrome.format).toBe("chrome-csv");
    expect(chrome.drafts[0]).toMatchObject({
      type: "login",
      name: "Example",
      username: "me@example.com",
      password: "hunter2",
      urls: ["https://example.com"],
    });

    const lastpass = importCsv(
      "url,username,password,extra,name,grouping,fav\nhttps://example.com,me@example.com,secret,note,Example,Work,1"
    );
    expect(lastpass.format).toBe("lastpass-csv");
    expect(lastpass.drafts[0]).toMatchObject({
      name: "Example",
      folder: "Work",
      favorite: true,
    });
  });

  it("detects semicolon and tab delimiters", () => {
    const semicolon = importCsv(
      "name;url;username;password\nExample;https://example.com;me;secret"
    );
    expect(semicolon.drafts[0].password).toBe("secret");

    const tabbed = importCsv(
      "name\turl\tusername\tpassword\nExample\thttps://example.com\tme\tsecret"
    );
    expect(tabbed.drafts[0].urls).toEqual(["https://example.com"]);
  });

  it("supports the Excel sep= line", () => {
    const preview = importCsv(
      "sep=;\nTitle;URL;Username;Password\nExample;https://example.com;me;secret"
    );
    expect(preview.drafts[0].name).toBe("Example");
  });

  it("imports cards and identities from generic headers", () => {
    const csv = importCsv(
      "type,name,card_number,card_holder,expiry,cvv,brand\ncard,Travel card,4111111111111111,Ada Lovelace,12/29,123,Visa"
    );
    expect(csv.drafts[0].type).toBe("card");
    expect(csv.drafts[0].card).toEqual({
      number: "4111111111111111",
      holder: "Ada Lovelace",
      expiry: "12/29",
      cvv: "123",
      brand: "Visa",
    });
  });

  it("imports Bitwarden JSON with folder names and cards", () => {
    const json = JSON.stringify({
      encrypted: false,
      folders: [{ id: "f1", name: "Work" }],
      items: [
        {
          type: 1,
          name: "GitHub",
          folderId: "f1",
          favorite: true,
          notes: "work account",
          login: {
            username: "octocat",
            password: "secret",
            uris: [{ uri: "https://github.com" }],
            totp: "JBSWY3DPEHPK3PXP",
          },
        },
        {
          type: 3,
          name: "Travel card",
          folderId: "f1",
          card: {
            cardholderName: "Ada Lovelace",
            number: "4111111111111111",
            expMonth: "12",
            expYear: "2029",
            code: "123",
            brand: "Visa",
          },
        },
      ],
    });

    const preview = importJson(json);
    expect(preview.format).toBe("bitwarden-json");
    expect(preview.drafts).toHaveLength(2);
    expect(preview.drafts[0]).toMatchObject({
      type: "login",
      name: "GitHub",
      folder: "Work",
      favorite: true,
      username: "octocat",
      urls: ["https://github.com"],
    });
    expect(preview.drafts[0].totp?.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(preview.drafts[1].card?.holder).toBe("Ada Lovelace");
    expect(preview.drafts[1].card?.expiry).toBe("12/2029");
  });

  it("accepts generic JSON arrays and dispatches by extension", () => {
    const preview = importPasswords(
      "passwords.json",
      JSON.stringify([
        { title: "Example", url: "https://example.com", username: "me", password: "secret" },
      ])
    );
    expect(preview.format).toBe("generic-json");
    expect(preview.drafts[0].name).toBe("Example");

    const csv = importPasswords("passwords.csv", "name,password\nExample,secret");
    expect(csv.format).toBe("generic-csv");
  });

  it("keeps the item and warns when a TOTP secret is invalid", () => {
    const preview = importCsv(
      "name,username,password,totp\nExample,me,secret,not-base32!"
    );
    expect(preview.drafts).toHaveLength(1);
    expect(preview.drafts[0].totp).toBeUndefined();
    expect(preview.warnings).toHaveLength(1);
  });
});
