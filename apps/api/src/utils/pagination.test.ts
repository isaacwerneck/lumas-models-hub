import { describe, expect, it } from "vitest";
import { paginationArgs, paginationMeta, paginationSchema } from "./pagination";

describe("paginação", () => {
  it("aplica padrões e converte query strings", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ page: "2", pageSize: "50" })).toEqual({ page: 2, pageSize: 50 });
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
    expect(() => paginationSchema.parse({ pageSize: 101 })).toThrow();
  });

  it("calcula offset e metadados inclusive para lista vazia", () => {
    expect(paginationArgs(3, 20)).toEqual({ skip: 40, take: 20 });
    expect(paginationMeta(2, 20, 45)).toEqual({ page: 2, pageSize: 20, total: 45, totalPages: 3 });
    expect(paginationMeta(1, 20, 0).totalPages).toBe(1);
  });
});
