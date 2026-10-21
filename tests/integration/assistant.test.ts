import { afterAll, beforeEach, expect, it } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { registerAssistantRoutes } from "../../server/assistant";
const firebase = initializeApp(
  { projectId: "demo-lablayer-test" },
  "assistant-test",
);
const db = getFirestore(firebase);
const app = express();
app.use(express.json());
const files = new Map<string, Buffer>();
let storeFailure = false;
registerAssistantRoutes(
  app,
  db,
  async (uid) => {
    if (uid === "invalid") throw Error();
    return { uid, superadmin: uid === "platform" } as any;
  },
  {
    put: async (path, bytes) => {
      if (storeFailure) throw Error("storage");
      files.set(path, bytes);
    },
    get: async (path) => files.get(path)!,
  },
);
let tenant: string, token: string, key: string;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const admin = (
  method: "get" | "post",
  path: string,
  body?: any,
  uid = tenant,
) =>
  request(app)[method](path).set("Authorization", `Bearer ${uid}`).send(body);
const call = (
  method: "get" | "post",
  path: string,
  body?: any,
  secret = token,
) =>
  request(app)
    [method](`/api/assistant${path}`)
    .set("Authorization", `Bearer ${secret}`)
    .send(body);
const payload = (extra: any = {}) => ({
  operationId: randomUUID(),
  intake: {
    title: "Chaveiro NFC",
    customerName: "Zalma",
    description: "Verde e branco",
    quantity: 10,
    provisionalQuantity: false,
  },
  message: "Cliente: Zalma\n10 unidades",
  attachments: [],
  ...extra,
});
const png = Buffer.from("89504e470d0a1a0a01020304", "hex");
const upload = (
  secret = token,
  body = png,
  name = "logo.png",
  mime = "image/png",
) =>
  request(app)
    .post("/api/assistant/assets")
    .set("Authorization", `Bearer ${secret}`)
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", encodeURIComponent(name))
    .set("X-File-Type", mime)
    .send(body);
beforeEach(async () => {
  tenant = `assistant-${randomUUID()}`;
  storeFailure = false;
  await db
    .doc(`tenants/${tenant}`)
    .set({ ownerUid: tenant, status: "active", companyName: "Empresa A" });
  const result = await admin("post", `/api/tenants/${tenant}/assistant-links`, {
    name: "Vendedor",
  }).expect(200);
  token = result.body.token;
  key = result.body.id;
});
afterAll(async () => {
  await db.terminate();
  await deleteApp(firebase);
});
it("somente proprietário ou administrador da plataforma gerencia links; segredo nunca aparece na listagem", async () => {
  const base = `/api/tenants/${tenant}/assistant-links`;
  await request(app).get(base).expect(401);
  await admin("post", base, { name: "X" }, "member").expect(403);
  await admin("get", base, undefined, "invalid").expect(401);
  const list = (await admin("get", base, undefined, "platform").expect(200))
    .body;
  expect(list.links[0].id).toBe(sha(token));
  expect(JSON.stringify(list)).not.toContain(token);
  expect(
    (await db.doc(`assistantLinks/${key}`).get()).data(),
  ).not.toHaveProperty("token");
});
it("cria solicitação, metadados e auditoria atomically; repetição concorrente gera um só pedido", async () => {
  const body = payload();
  const responses = await Promise.all([
    call("post", "/requests", body),
    call("post", "/requests", body),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(responses[0].body.id).toBe(responses[1].body.id);
  const docs = await db.collection(`tenants/${tenant}/customRequests`).get();
  expect(docs.size).toBe(1);
  const value = docs.docs[0].data();
  expect(value).toMatchObject({
    status: "aguardando-orcamento",
    requestedQuantity: 10,
    sourceMessage: body.message,
    productionTimeHours: 0,
  });
  expect(value).not.toHaveProperty("quotedPrice");
  expect(value).not.toHaveProperty("approvedAt");
  expect((await db.doc(`assistantLinks/${key}`).get()).data()?.requests).toBe(
    1,
  );
  expect(
    (
      await db
        .collection(`tenants/${tenant}/auditLogs`)
        .where("operation", "==", "assistant.request-created")
        .get()
    ).size,
  ).toBe(1);
  await call("post", "/requests", { ...body, message: "diferente" }).expect(
    409,
  );
});
it("não permite gravar status, preço, empresa ou quantidade inválida", async () => {
  for (const injected of [
    { status: "orcado" },
    { tenantId: "other" },
    { quotedPrice: 1 },
  ])
    await call("post", "/requests", { ...payload(), ...injected }).expect(422);
  for (const quantity of [0, -1, 1.5, 100001, "10", null]) {
    const body = payload();
    body.intake.quantity = quantity;
    await call("post", "/requests", body).expect(422);
  }
  expect(
    (await db.collection(`tenants/${tenant}/customRequests`).get()).empty,
  ).toBe(true);
});
it("quantidade provisória é explícita e medidas não se tornam quantidade", async () => {
  const draft = (
    await call("post", "/draft", { message: "Boneca ProFaby 12cm" }).expect(200)
  ).body.draft;
  expect(draft).toMatchObject({ quantity: 1, provisionalQuantity: true });
  const body = payload({ intake: draft, message: "Boneca ProFaby 12cm" });
  const saved = await call("post", "/requests", body).expect(200);
  const value = (
    await db.doc(`tenants/${tenant}/customRequests/${saved.body.id}`).get()
  ).data();
  expect(value?.description).toContain("Quantidade provisória: 1");
});
it("isola dois vendedores da mesma empresa e outras empresas, inclusive anexos e complementos", async () => {
  const other = (
    await admin("post", `/api/tenants/${tenant}/assistant-links`, {
      name: "Outro",
    })
  ).body.token;
  const image = (await upload().expect(200)).body;
  const saved = (
    await call(
      "post",
      "/requests",
      payload({ attachments: [image.id] }),
    ).expect(200)
  ).body;
  expect((await call("get", "", undefined, other)).body.requests).toEqual([]);
  await call("get", `/requests/${saved.id}`, undefined, other).expect(404);
  await call("get", `/assets/${image.id}`, undefined, other).expect(404);
  await call(
    "post",
    "/requests",
    payload({ attachments: [image.id] }),
    other,
  ).expect(422);
  await call(
    "post",
    `/requests/${saved.id}/notes`,
    { operationId: randomUUID(), message: "Injetar", attachments: [] },
    other,
  ).expect(404);
  await admin(
    "get",
    `/api/tenants/${tenant}/assistant-requests/${saved.id}`,
    undefined,
    "outsider",
  ).expect(403);
});
it("revogação e expiração bloqueiam imediatamente leitura e gravação", async () => {
  await admin(
    "post",
    `/api/tenants/${tenant}/assistant-links/${key}/revoke`,
    {},
  ).expect(200);
  await call("get", "").expect(403);
  await call("post", "/requests", payload()).expect(403);
  await upload().expect(403);
  await db
    .doc(`assistantLinks/${key}`)
    .update({ active: true, expiresAt: "2000-01-01T00:00:00.000Z" });
  await call("get", "").expect(403);
});
it("empresa inativa bloqueia o link e não grava nada", async () => {
  await db.doc(`tenants/${tenant}`).update({ status: "inactive" });
  await call("get", "").expect(403);
  await call("post", "/requests", payload()).expect(403);
  expect(
    (await db.collection(`tenants/${tenant}/customRequests`).get()).empty,
  ).toBe(true);
});
it("upload preserva bytes, confirma armazenamento e só então permite associar o anexo", async () => {
  const image = (await upload().expect(200)).body;
  expect((await upload().expect(200)).body.id).toBe(image.id);
  const result = await call("get", `/assets/${image.id}`).expect(200);
  expect(result.body.equals(png)).toBe(true);
  expect(result.headers["cache-control"]).toBe("private, no-store");
  const saved = await call(
    "post",
    "/requests",
    payload({ attachments: [image.id] }),
  ).expect(200);
  expect(
    (
      await db.doc(`tenants/${tenant}/customRequests/${saved.body.id}`).get()
    ).data()?.referenceImageUrl,
  ).toBe(`asset:${image.id}`);
  storeFailure = true;
  await upload(token, Buffer.concat([png, Buffer.from("different")])).expect(
    503,
  );
  expect((await db.collection(`assistantLinks/${key}/assets`).get()).size).toBe(
    1,
  );
});
it("aceita áudio com assinatura válida e bloqueia falso formato, caminho e excesso de tamanho", async () => {
  const wav = Buffer.concat([Buffer.from("RIFF0000WAVE"), Buffer.alloc(20)]);
  await upload(token, wav, "voz.wav", "audio/wav").expect(200);
  await upload(token, Buffer.from("<script/>"), "x.png", "image/png").expect(
    422,
  );
  await upload(token, png, "../x.png", "image/png").expect(422);
  await upload(token, png, "x.svg", "image/svg+xml").expect(422);
  await upload(token, Buffer.alloc(10 * 1024 * 1024 + 1)).expect(413);
});
it("complementos são idempotentes, aparecem para equipe e não alteram preços/status/texto original", async () => {
  const saved = (await call("post", "/requests", payload())).body;
  const before = (
    await db.doc(`tenants/${tenant}/customRequests/${saved.id}`).get()
  ).data();
  const body = {
    operationId: randomUUID(),
    message: "Cor confirmada: azul",
    attachments: [],
  };
  await call("post", `/requests/${saved.id}/notes`, body).expect(200);
  await call("post", `/requests/${saved.id}/notes`, body).expect(200);
  const result = (
    await admin(
      "get",
      `/api/tenants/${tenant}/assistant-requests/${saved.id}`,
    ).expect(200)
  ).body;
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0].message).toBe(body.message);
  expect(
    (await db.doc(`tenants/${tenant}/customRequests/${saved.id}`).get()).data(),
  ).toEqual(before);
  await call("post", `/requests/${saved.id}/notes`, {
    ...body,
    message: "Outra cor",
  }).expect(409);
});
it("consulta mostra status atual sem revelar custos ou notas internas", async () => {
  const saved = (await call("post", "/requests", payload())).body;
  await db.doc(`tenants/${tenant}/customRequests/${saved.id}`).update({
    status: "orcado",
    quotedPrice: 999,
    estimatedUnitCost: 200,
    description: "Informação interna",
  });
  const result = (await call("get", `/requests/${saved.id}`)).body;
  expect(result.status).toBe("orcado");
  expect(result.description).toBe("Verde e branco");
  expect(result).not.toHaveProperty("quotedPrice");
  expect(result).not.toHaveProperty("estimatedUnitCost");
});
it("cotas persistentes impedem pedidos e arquivos excedentes; repetição confirmada ainda funciona", async () => {
  const body = payload();
  await call("post", "/requests", body).expect(200);
  await db.doc(`assistantLinks/${key}`).update({
    quotaDay: new Date().toISOString().slice(0, 10),
    requests: 100,
    bytes: 50 * 1024 * 1024,
  });
  await call("post", "/requests", payload()).expect(429);
  await call("post", "/requests", body).expect(200);
  await upload().expect(429);
  expect(
    (await db.collection(`tenants/${tenant}/customRequests`).get()).size,
  ).toBe(1);
});
it("acesso sem credencial, aleatório e tentativa de revogar link alheio falham", async () => {
  await request(app).get("/api/assistant").expect(401);
  await call("get", "", undefined, "x".repeat(43)).expect(403);
  await admin(
    "post",
    `/api/tenants/${tenant}/assistant-links/${"a".repeat(64)}/revoke`,
    {},
  ).expect(404);
});

it("não cria pedidos ocultos após migração ao novo fluxo de estoque", async () => {
  await db
    .doc(`tenants/${tenant}/inventoryControl/state`)
    .set({ phase: "active" });
  await call("post", "/requests", payload()).expect(409);
  expect(
    (await db.collection(`tenants/${tenant}/customRequests`).get()).empty,
  ).toBe(true);
});

it('atendimento compartilhado consulta pedidos manuais e de outro vendedor com dados atuais', async () => {
  await db.doc(`tenants/${tenant}`).update({ assistantSharedRequests: true });
  const other = (await admin('post', `/api/tenants/${tenant}/assistant-links`, { name: 'Turno B' })).body.token;
  const saved = (await call('post', '/requests', payload()).expect(200)).body;
  await db.doc(`tenants/${tenant}/customRequests/${saved.id}`).update({ title: 'Título revisado', requestedQuantity: 12, quotedPrice: 95 });
  await db.doc(`tenants/${tenant}/customRequests/manual`).set({ title: 'Pedido manual sem data', requestedQuantity: 3, status: 'orcado', description: 'Referência original', quotedPrice: 42, internalCost: 9 });
  const list = (await call('get', '', undefined, other).expect(200)).body;
  expect(list.requestScope).toBe('tenant'); expect(list.requests).toHaveLength(2);
  const result = (await call('get', `/requests/${saved.id}`, undefined, other).expect(200)).body;
  expect(result).toMatchObject({ title: 'Título revisado', quantity: 12, quotedPrice: 95 });
  const manual = (await call('get', '/requests/manual', undefined, other).expect(200)).body;
  expect(manual).toMatchObject({ title: 'Pedido manual sem data', quantity: 3, quotedPrice: 42 });
  expect(manual).not.toHaveProperty('internalCost');
  const note = { operationId: randomUUID(), message: 'Turno B confirmou a cor', attachments: [] };
  await call('post', '/requests/manual/notes', note, other).expect(200);
  await call('post', '/requests/manual/notes', note, other).expect(200);
  const notes = (await call('get', '/requests/manual').expect(200)).body.notes;
  expect(notes).toHaveLength(1); expect(notes[0]).toMatchObject({ message: note.message, seller: 'Turno B' });
});
it('compartilhamento permite apenas anexos vinculados ao pedido, mantendo uploads privados e isolamento de empresa', async () => {
  await db.doc(`tenants/${tenant}`).update({ assistantSharedRequests: true });
  const other = (await admin('post', `/api/tenants/${tenant}/assistant-links`, { name: 'Outro turno' })).body.token;
  const file = (await upload().expect(200)).body;
  const saved = (await call('post', '/requests', payload({ attachments: [file.id] })).expect(200)).body;
  await call('get', `/assets/${file.id}?requestId=${saved.id}`, undefined, other).expect(200);
  await call('get', `/assets/${file.id}`, undefined, other).expect(404);
  await call('post', '/requests', payload({ attachments: [file.id] }), other).expect(422);
  await db.doc(`tenants/${tenant}/customRequests/manual`).set({ title: 'Manual', referenceImageUrl: `asset:${file.id}` });
  expect((await call('get', '/requests/manual', undefined, other)).body.attachments[0].id).toBe(file.id);
  await call('get', `/assets/${file.id}?requestId=manual`, undefined, other).expect(200);
  await db.doc(`tenants/${tenant}/customRequests/unrelated`).set({ title: 'Sem anexo' });
  await call('get', `/assets/${file.id}?requestId=unrelated`, undefined, other).expect(404);
  await db.doc(`tenants/foreign-${tenant}`).set({ ownerUid: `foreign-${tenant}`, status: 'active', assistantSharedRequests: true });
  const foreign = (await admin('post', `/api/tenants/foreign-${tenant}/assistant-links`, { name: 'Empresa B' }, `foreign-${tenant}`)).body.token;
  expect((await call('get', '', undefined, foreign)).body.requests).toEqual([]);
  await call('get', `/requests/${saved.id}`, undefined, foreign).expect(404);
  await call('post', `/requests/${saved.id}/notes`, { operationId: randomUUID(), message: 'Não permitido', attachments: [] }, foreign).expect(404);
  await call('get', `/assets/${file.id}?requestId=${saved.id}`, undefined, foreign).expect(404);
});
it('pagina todos os pedidos compartilhados, inclusive registros antigos sem data', async () => {
  await db.doc(`tenants/${tenant}`).update({ assistantSharedRequests: true });
  const batch = db.batch();
  for (let n = 0; n < 103; n++) batch.set(db.doc(`tenants/${tenant}/customRequests/item-${String(n).padStart(3, '0')}`), { title: `Pedido ${n}` });
  await batch.commit();
  const first = (await call('get', '').expect(200)).body;
  expect(first.requests).toHaveLength(100); expect(first.nextCursor).toBe('item-099');
  const second = (await call('get', `?cursor=${first.nextCursor}`).expect(200)).body;
  expect(second.requests).toHaveLength(3); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.requests, ...second.requests].map(x => x.id)).size).toBe(103);
  await call('get', '?cursor=invalid/path').expect(422);
  await db.doc(`assistantLinks/${key}`).update({ active: false });
  await call('get', '').expect(403);
});
