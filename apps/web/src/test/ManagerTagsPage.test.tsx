import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerTagsPage } from "../pages/ManagerTagsPage";
import { ToastProvider } from "../components/Toast";

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("../lib/api", () => ({ api: apiMocks }));

const tags = [{ id: "tag-1", name: "Annie", isActive: true, chatterCount: 1 }];
const chatters = [
  { id: "chatter-1", displayName: "Isaac", modelTags: [{ id: "tag-1", name: "Annie" }] },
  { id: "chatter-2", displayName: "Bia", modelTags: [] }
];

describe("ManagerTagsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((url: string) => Promise.resolve({ data: url.includes("/tags") ? { tags } : { chatters } }));
    apiMocks.post.mockResolvedValue({ data: {} });
    apiMocks.put.mockResolvedValue({ data: {} });
    apiMocks.delete.mockResolvedValue({ data: {} });
  });
  afterEach(() => cleanup());

  it("cria, vincula e exclui tag com confirmação própria", async () => {
    render(<ToastProvider><ManagerTagsPage /></ToastProvider>);
    expect(await screen.findByText("Isaac")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nome da tag"), { target: { value: "Bella" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tag" }));
    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledWith("/manager/tags", { name: "Bella" }));

    fireEvent.change(screen.getByLabelText("Chatter"), { target: { value: "chatter-2" } });
    expect(screen.getByRole("button", { name: "Salvar vínculos" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Annie" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar vínculos" }));
    await waitFor(() => expect(apiMocks.put).toHaveBeenCalledWith("/manager/chatters/chatter-2/tags", { modelTagIds: ["tag-1"] }));

    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    const modal = screen.getByRole("heading", { name: "Excluir tag" }).closest<HTMLElement>(".modal")!;
    fireEvent.click(within(modal).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Excluir tag" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir tag" }));
    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith("/manager/tags/tag-1"));
  });

  it("mostra erro v1 de mutação sem bloquear a lista", async () => {
    apiMocks.post.mockRejectedValue({ response: { data: { error: { message: "Tag duplicada" } } } });
    render(<ToastProvider><ManagerTagsPage embedded /></ToastProvider>);
    await screen.findByText("Isaac");
    fireEvent.change(screen.getByLabelText("Nome da tag"), { target: { value: "Annie" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tag" }));
    expect(await screen.findByText("Tag duplicada")).toBeInTheDocument();
  });
});
