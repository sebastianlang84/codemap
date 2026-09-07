import assert from "node:assert/strict";
import test from "node:test";
import { planQuery } from "../src/core/query-plan.ts";

const padding = "please find the code that handles the response when a client cancels";
const identifiers = ["sendTrailers", "send_trailers", "response.sendTrailers", "HTTPResponseWriter"];
for (const identifier of identifiers) {
  for (const position of ["start", "middle", "end"] as const) {
    const query = position === "start" ? `${identifier} ${padding}`
      : position === "middle" ? `please find ${identifier} the code that handles the response when a client cancels`
      : `${padding} ${identifier}`;
    test(`retains ${identifier} at ${position} of a long query`, () => {
      const plan = planQuery(query);
      assert.ok(plan.terms.includes(identifier.toLowerCase()));
      assert.ok(plan.coreTerms.includes(identifier.toLowerCase()));
      assert.ok(plan.ftsQueries.some(({ query }) => query.includes(`"${identifier.toLowerCase()}"`)));
      assert.ok(plan.terms.length <= 16);
      assert.ok(plan.ftsQueries.length <= 6);
    });
  }
}

test("preserves multiple late identifiers within the existing term budget", () => {
  const plan = planQuery(`${padding} sendTrailers send_headers response.write`);
  for (const identifier of ["sendtrailers", "send_headers", "response.write"]) {
    assert.ok(plan.terms.includes(identifier));
  }
  assert.ok(plan.terms.length <= 16);
});

test("preserves concise query terms and quoted phrases", () => {
  assert.deepEqual(planQuery("response handler").terms, ["response", "handler"]);
  assert.deepEqual(planQuery("sendTrailers").terms, ["sendtrailers", "send", "trailers"]);
  const plan = planQuery('"response handler"');
  assert.deepEqual(plan.phrases, ["response handler"]);
  assert.deepEqual(plan.ftsQueries[0], { query: '"response handler"', tierBoost: 24 });
});

test("preserves explicit quoted phrases in long queries", () => {
  const plan = planQuery(`${padding} "response handler" sendTrailers`);
  assert.deepEqual(plan.phrases, ["response handler"]);
  assert.deepEqual(plan.ftsQueries[0], { query: '"response handler"', tierBoost: 24 });
});
