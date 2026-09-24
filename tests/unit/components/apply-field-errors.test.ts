import type { ErrorOption } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { applyFieldErrors } from "@/components/forms/use-server-action";

type Form = { email: string; name: string };

function recorder() {
  const calls: [string, ErrorOption][] = [];
  const setError = (field: string, error: ErrorOption) => {
    calls.push([field, error]);
  };
  return { calls, setError };
}

describe("applyFieldErrors", () => {
  it("sets the first server message on each field that has one", () => {
    const { calls, setError } = recorder();
    applyFieldErrors<Form>(setError, { email: ["Already in use", "Second message"], name: [] });
    expect(calls).toEqual([["email", { type: "server", message: "Already in use" }]]);
  });
  it("does nothing without field errors", () => {
    const { calls, setError } = recorder();
    applyFieldErrors<Form>(setError, undefined);
    expect(calls).toEqual([]);
  });
});
