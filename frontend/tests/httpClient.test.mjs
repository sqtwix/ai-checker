import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { requestJson, SESSION_EXPIRED_EVENT } from "../src/httpClient.js";

let values;
let expirations;
beforeEach(() => {
  values = new Map([["token", "old-session"], ["username", "Tester"]]);
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
  };
  globalThis.window = new EventTarget();
  expirations = 0;
  window.addEventListener(SESSION_EXPIRED_EVENT, () => expirations++);
});

test("an empty 401 expires the session and explains how to recover", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  await assert.rejects(requestJson("/upload"), error => error.status === 401 && error.message.includes("Войдите снова"));
  assert.equal(values.has("token"), false);
  assert.equal(expirations, 1);
});

test("a delayed 401 cannot remove a fresh login", async () => {
  globalThis.fetch = async () => {
    values.set("token", "new-session");
    return new Response(null, { status: 401 });
  };
  await assert.rejects(requestJson("/history"));
  assert.equal(values.get("token"), "new-session");
  assert.equal(expirations, 0);
});

test("wrong login credentials do not expire an existing session", async () => {
  globalThis.fetch = async () => new Response(null, { status: 401 });
  await assert.rejects(requestJson("/login", {}, { authenticated: false }), /Неверный email/);
  assert.equal(values.get("token"), "old-session");
  assert.equal(expirations, 0);
});

test("missing authentication blocks file upload before sending the body", async () => {
  values.clear();
  globalThis.fetch = () => assert.fail("upload should not be sent");
  await assert.rejects(requestJson("/upload", { method: "POST", body: new FormData() }), /Войдите снова/);
});

test("multipart boundary is left to the browser", async () => {
  const body = new FormData();
  body.append("file", new Blob(["test"]), "test.csv");
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers["Content-Type"], undefined);
    assert.equal(options.headers.Authorization, "Bearer old-session");
    assert.equal(options.body, body);
    return Response.json({ task_id: "task" }, { status: 202 });
  };
  assert.deepEqual(await requestJson("/upload", { method: "POST", body }), { task_id: "task" });
});

test("plain-text validation errors are preserved and proxy HTML is replaced", async () => {
  globalThis.fetch = async () => new Response("Нет обязательной колонки", { status: 400 });
  await assert.rejects(requestJson("/upload"), /Нет обязательной колонки/);
  globalThis.fetch = async () => new Response("<html>413</html>", { status: 413 });
  await assert.rejects(requestJson("/upload"), /Размер файлов/);
  globalThis.fetch = async () => Response.json({ errors: { file: ["Пустой файл"] } }, { status: 400 });
  await assert.rejects(requestJson("/upload"), /Пустой файл/);
});

test("empty success, broken response and network failures are handled", async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await requestJson("/archive"), null);
  globalThis.fetch = async () => new Response("<html>Wrong route</html>");
  await assert.rejects(requestJson("/history"), /некорректный ответ/);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(requestJson("/upload"), error => error.status === 0 && error.message.includes("сервером"));
});
