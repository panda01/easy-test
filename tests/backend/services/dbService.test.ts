import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `dbService` reads DATABASE_URL and constructs the PrismaPg adapter in its
 * MODULE BODY, so both have to be in place before the import below is
 * evaluated. `vi.hoisted` runs ahead of the hoisted imports, which is the only
 * hook early enough to do it.
 */
const { mockWebsiteDelegate } = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://tester@localhost:5432/easy_test_unit?schema=public";
  return {
    mockWebsiteDelegate: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// The generated client and the driver adapter are both stubbed: this spec is
// about the query shapes dbService builds, not about Postgres itself. The real
// database round-trip is proven separately by the manual verification run.
// Both are instantiated with `new`, so the stubs have to be constructible -
// an arrow function is not, and vitest rejects it at construction time.
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {},
}));

vi.mock("../../../server/generated/prisma/client.js", () => ({
  PrismaClient: class MockPrismaClient {
    website = mockWebsiteDelegate;
  },
}));

import {
  createWebsite,
  listWebsites,
  findWebsiteByUrl,
  deleteWebsiteByUrl,
} from "../../../server/services/dbService.js";

const sampleWebsite = {
  id: "cuid-1",
  url: "https://example.com",
  name: "Example",
  description: "a site to test",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("dbService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createWebsite inserts the supplied fields and returns the created row", async () => {
    mockWebsiteDelegate.create.mockResolvedValue(sampleWebsite);

    const created = await createWebsite({
      url: "https://example.com",
      name: "Example",
      description: "a site to test",
    });

    expect(mockWebsiteDelegate.create).toHaveBeenCalledWith({
      data: { url: "https://example.com", name: "Example", description: "a site to test" },
    });
    expect(created).toBe(sampleWebsite);
  });

  it("createWebsite accepts an omitted description", async () => {
    mockWebsiteDelegate.create.mockResolvedValue(sampleWebsite);

    await createWebsite({ url: "https://example.com", name: "Example" });

    expect(mockWebsiteDelegate.create).toHaveBeenCalledWith({
      data: { url: "https://example.com", name: "Example" },
    });
  });

  it("listWebsites orders by createdAt descending", async () => {
    mockWebsiteDelegate.findMany.mockResolvedValue([sampleWebsite]);

    const websites = await listWebsites();

    expect(mockWebsiteDelegate.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
    expect(websites).toEqual([sampleWebsite]);
  });

  it("findWebsiteByUrl queries the unique url column", async () => {
    mockWebsiteDelegate.findUnique.mockResolvedValue(sampleWebsite);

    const found = await findWebsiteByUrl("https://example.com");

    expect(mockWebsiteDelegate.findUnique).toHaveBeenCalledWith({
      where: { url: "https://example.com" },
    });
    expect(found).toBe(sampleWebsite);
  });

  it("findWebsiteByUrl returns null when no row matches", async () => {
    mockWebsiteDelegate.findUnique.mockResolvedValue(null);

    expect(await findWebsiteByUrl("https://nope.example")).toBeNull();
  });

  it("deleteWebsiteByUrl deletes the row with that url", async () => {
    mockWebsiteDelegate.delete.mockResolvedValue(sampleWebsite);

    await deleteWebsiteByUrl("https://example.com");

    expect(mockWebsiteDelegate.delete).toHaveBeenCalledWith({
      where: { url: "https://example.com" },
    });
  });
});
