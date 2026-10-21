// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AssistantChat } from "../../src/features/assistant/Assistant";
vi.mock("../../src/contexts/AuthContext", () => ({ useAuth: () => ({}) }));
const fake = vi.fn();
const reply = (body: any, ok = true) => ({ ok, json: async () => body });
beforeEach(() => {
  window.location.hash = "a".repeat(43);
  fake.mockReset();
  vi.stubGlobal("fetch", fake);
  fake.mockImplementation(async (path: string) => {
    if (path === "/api/assistant")
      return reply({ company: "Empresa", seller: "Vendedor", requests: [] });
    if (path === "/api/assistant/draft")
      return reply({
        draft: {
          title: "Boneco 12 cm",
          customerName: "",
          description: "Boneco 12 cm",
          quantity: 1,
          provisionalQuantity: true,
        },
        message: "Confira os dados.",
      });
    if (path === "/api/assistant/requests") throw Error("Conexão perdida");
    throw Error("Unexpected path");
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("exige conferência, não anuncia sucesso com falha e reenvia exatamente o mesmo pedido", async () => {
  render(<AssistantChat />);
  fireEvent.change(await screen.findByLabelText("Conte o pedido do cliente"), {
    target: { value: "Boneco 12 cm" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preparar solicitação" }));
  await screen.findByText("Confira antes de cadastrar");
  expect(screen.getByText(/1 unidade provisória/)).toBeTruthy();
  expect(fake.mock.calls.some((c) => c[0] === "/api/assistant/requests")).toBe(
    false,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cadastrar no LabLayer" }),
  );
  await screen.findByText("Conexão perdida");
  expect(screen.queryByText(/Solicitação cadastrada/)).toBeNull();
  const first = fake.mock.calls.find(
    (c) => c[0] === "/api/assistant/requests",
  )![1].body;
  fireEvent.click(
    screen.getByRole("button", { name: "Reenviar o mesmo pedido" }),
  );
  await waitFor(() =>
    expect(
      fake.mock.calls.filter((c) => c[0] === "/api/assistant/requests"),
    ).toHaveLength(2),
  );
  expect(
    fake.mock.calls.filter((c) => c[0] === "/api/assistant/requests")[1][1]
      .body,
  ).toBe(first);
});
it("link revogado apresenta erro de acesso sem formulário de envio", async () => {
  fake.mockResolvedValue(reply({ error: "Link revogado" }, false));
  render(<AssistantChat />);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Conte o pedido do cliente")).toBeNull();
});
