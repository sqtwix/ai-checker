import { test } from "node:test";
import assert from "node:assert/strict";
import { watchAnalysis } from "../src/analysisPolling.js";

function scheduler() {
  const queue = new Map();
  let nextId = 0;
  return {
    queue,
    schedule: callback => { const id = ++nextId; queue.set(id, callback); return id; },
    cancel: id => queue.delete(id),
    async tick() {
      const [id, callback] = queue.entries().next().value;
      queue.delete(id);
      await callback();
    },
  };
}

test("analysis can complete after more than the old 200-poll limit", async () => {
  const clock = scheduler();
  let requests = 0;
  const statuses = [];
  watchAnalysis({
    ...clock,
    getStatus: async () => ({ status: ++requests > 250 ? "Completed" : "Processing" }),
    onStatus: value => statuses.push(value.status),
    onError: error => assert.fail(error.message),
  });
  while (clock.queue.size) await clock.tick();
  assert.equal(requests, 251);
  assert.equal(statuses.at(-1), "Completed");
});

test("cancellation is polled until acknowledged and never treated as failure", async () => {
  const clock = scheduler();
  const states = ["Processing", "Cancelling", "Cancelled"];
  const seen = [];
  watchAnalysis({ ...clock, getStatus: async () => ({ status: states.shift() }), onStatus: value => seen.push(value.status), onError: error => assert.fail(error.message) });
  while (clock.queue.size) await clock.tick();
  assert.deepEqual(seen, ["Processing", "Cancelling", "Cancelled"]);
});

test("logout cancels a pending response and schedules no new poll", async () => {
  const clock = scheduler();
  let resolve;
  const stop = watchAnalysis({
    ...clock,
    getStatus: () => new Promise(done => { resolve = done; }),
    onStatus: () => assert.fail("late response after logout"),
    onError: error => assert.fail(error.message),
  });
  const inFlight = clock.tick();
  stop();
  resolve({ status: "Completed" });
  await inFlight;
  assert.equal(clock.queue.size, 0);
});

test("401 stops immediately, intermittent network errors can recover", async () => {
  const clock = scheduler();
  const errors = [];
  watchAnalysis({ ...clock, getStatus: async () => { throw { status: 401 }; }, onStatus: () => {}, onError: e => errors.push(e) });
  await clock.tick();
  assert.equal(errors.length, 1);
  assert.equal(clock.queue.size, 0);
  let requests = 0;
  watchAnalysis({
    ...clock,
    getStatus: async () => {
      if (++requests < 4) throw new Error("temporary outage");
      return { status: "Completed" };
    },
    onStatus: () => {},
    onError: error => assert.fail(error.message),
  });
  while (clock.queue.size) await clock.tick();
  assert.equal(requests, 4);
});
