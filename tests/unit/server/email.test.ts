import { afterEach, describe, expect, it } from "vitest";
import { isEmailConfigured, renderEmail, sendEmail } from "@/server/lib/email";

const saved = { host: process.env.SMTP_HOST, from: process.env.SMTP_FROM };

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  restore("SMTP_HOST", saved.host);
  restore("SMTP_FROM", saved.from);
});

describe("email", () => {
  it("skips sending when SMTP is not configured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    expect(isEmailConfigured()).toBe(false);
    await expect(sendEmail({ to: "a@pvcon.in", subject: "Hi", text: "t", html: "<p>t</p>" })).resolves.toEqual({ sent: false });
  });

  it("renders escaped HTML and a plain-text alternative", () => {
    const { html, text } = renderEmail({
      heading: "Reset <your> password",
      paragraphs: ["Click the button & continue."],
      action: { label: "Reset password", url: "https://people.pvcon.in/reset-password/abc" },
    });
    expect(html).toContain("Reset &lt;your&gt; password");
    expect(html).toContain("Click the button &amp; continue.");
    expect(html).toContain('href="https://people.pvcon.in/reset-password/abc"');
    expect(text).toContain("Reset <your> password");
    expect(text).toContain("Reset password: https://people.pvcon.in/reset-password/abc");
  });
});
