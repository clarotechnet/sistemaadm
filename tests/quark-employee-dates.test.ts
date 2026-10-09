import assert from "node:assert/strict";
import test from "node:test";
import { parseQuarkEmployeeDate } from "../supabase/functions/sync-quark-employees/date-utils.ts";

const utcMs = (text: string) => Date.parse(text);

test("QuarkRH 13-digit Unix millisecond dates become São Paulo calendar dates", () => {
  assert.equal(parseQuarkEmployeeDate(utcMs("2026-09-08T03:00:00Z")), "2026-09-08");
  assert.equal(parseQuarkEmployeeDate(String(utcMs("2026-09-08T03:00:00Z"))), "2026-09-08");
  assert.equal(parseQuarkEmployeeDate(utcMs("2026-09-08T02:00:00Z")), "2026-09-07");
});

test("QuarkRH 10-digit Unix seconds also work", () => {
  assert.equal(parseQuarkEmployeeDate(utcMs("2026-09-08T03:00:00Z") / 1000), "2026-09-08");
});

test("existing ISO date-only and ISO date-time formats remain compatible", () => {
  assert.equal(parseQuarkEmployeeDate("2026-09-08"), "2026-09-08");
  assert.equal(parseQuarkEmployeeDate("2026-09-08T03:00:00.000Z"), "2026-09-08");
  assert.equal(parseQuarkEmployeeDate("08/09/2026"), "2026-09-08");
});

test("missing, zero and invalid dates are rejected", () => {
  for (const value of [null, undefined, "", 0, "0", "not-a-date", "2026-02-30", "31/02/2026"]) {
    assert.equal(parseQuarkEmployeeDate(value), null);
  }
});

test("historical São Paulo summer time does not shift a midnight admission", () => {
  assert.equal(parseQuarkEmployeeDate(utcMs("2018-12-01T02:00:00Z")), "2018-12-01");
});
