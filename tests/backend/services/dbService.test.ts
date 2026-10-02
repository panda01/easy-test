import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `dbService` reads DATABASE_URL and constructs the PrismaPg adapter in its
 * MODULE BODY, so both have to be in place before the import below is
 * evaluated. `vi.hoisted` runs ahead of the hoisted imports, which is the only
 * hook early enough to do it.
 */
const { mockWebsiteDelegate, mockUseCaseDelegate, mockActionDelegate, mockTransaction } = vi.hoisted(
  () => {
    process.env.DATABASE_URL = "postgresql://tester@localhost:5432/easy_test_unit?schema=public";

    /**
     * Builds a stand-in for one Prisma model delegate (`prisma.website`,
     * `prisma.useCase`, `prisma.action`) carrying every method dbService calls.
     * @returns An object whose query methods are bare vitest mocks
     */
    function createMockModelDelegate() {
      return {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      };
    }

    const websiteDelegate = createMockModelDelegate();
    const useCaseDelegate = createMockModelDelegate();
    const actionDelegate = createMockModelDelegate();
    // The transaction-scoped client exposes the same delegates, so assertions
    // on a delegate hold whether a query ran inside or outside `$transaction`.
    const transactionClient = {
      website: websiteDelegate,
      useCase: useCaseDelegate,
      action: actionDelegate,
    };

    return {
      mockWebsiteDelegate: websiteDelegate,
      mockUseCaseDelegate: useCaseDelegate,
      mockActionDelegate: actionDelegate,
      // Interactive-transaction form only: run the callback against the
      // transaction-scoped client and resolve with whatever it returns.
      mockTransaction: vi.fn(
        (callback: (transaction: typeof transactionClient) => Promise<boolean>) =>
          callback(transactionClient),
      ),
    };
  },
);

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
    useCase = mockUseCaseDelegate;
    action = mockActionDelegate;
    $transaction = mockTransaction;
  },
}));

import {
  isUniqueConstraintViolation,
  isRecordNotFound,
  createWebsite,
  listWebsites,
  findWebsiteByUrl,
  findWebsiteById,
  updateWebsite,
  softDeleteWebsite,
  listUseCasesForWebsite,
  findUseCaseForWebsite,
  createUseCaseForWebsite,
  updateUseCaseForWebsite,
  softDeleteUseCaseForWebsite,
  listActionsForWebsite,
  findActionForWebsite,
  createActionForWebsite,
  updateActionForWebsite,
  softDeleteActionForWebsite,
} from "../../../server/services/dbService.js";

const sampleWebsite = {
  id: "cuid-1",
  url: "https://example.com",
  name: "Example",
  description: "a site to test",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
};

const sampleUseCase = {
  id: "use-case-1",
  websiteId: "cuid-1",
  title: "Sign up",
  description: "Create an account",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  deletedAt: null,
};

const sampleAction = {
  id: "action-1",
  websiteId: "cuid-1",
  title: "Log in",
  description: "Enter credentials and submit",
  createdAt: new Date("2026-01-03T00:00:00.000Z"),
  updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  deletedAt: null,
};

/** What Prisma rejects with when an `update` matches no row. */
const recordNotFoundError = { code: "P2025", message: "Record to update not found." };

/** What Prisma rejects with when a write collides with a unique index. */
const uniqueConstraintError = { code: "P2002", message: "Unique constraint failed" };

/**
 * Reads the `deletedAt` value a mocked `updateMany` was asked to write.
 * @param updateManyMock - The `updateMany` mock of one model delegate
 * @param callIndex - Which recorded call to read; the first call by default
 * @returns The `data.deletedAt` argument of that call
 */
function readDeletedAtWrittenBy(
  updateManyMock: typeof mockWebsiteDelegate.updateMany,
  callIndex = 0,
): unknown {
  const [updateManyArguments] = updateManyMock.mock.calls[callIndex] as [
    { data: { deletedAt: unknown } },
  ];
  return updateManyArguments.data.deletedAt;
}

describe("dbService", () => {
  beforeEach(() => {
    // resetAllMocks also drops any leftover mockResolvedValue / Once queue,
    // while `mockTransaction` keeps the implementation it was created with.
    vi.resetAllMocks();
  });

  describe("module load", () => {
    it("throws when DATABASE_URL is not defined, before any client is built", async () => {
      const originalDatabaseUrl = process.env.DATABASE_URL;
      vi.resetModules();
      delete process.env.DATABASE_URL;

      try {
        await expect(import("../../../server/services/dbService.js")).rejects.toThrow(
          /DATABASE_URL is not defined/,
        );
      } finally {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
    });
  });

  describe("isUniqueConstraintViolation", () => {
    it("is true for an object carrying the P2002 code", () => {
      expect(isUniqueConstraintViolation(uniqueConstraintError)).toBe(true);
    });

    it("is true for an Error instance carrying the P2002 code", () => {
      const prismaLikeError = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
      expect(isUniqueConstraintViolation(prismaLikeError)).toBe(true);
    });

    it("is false for an object carrying a different code", () => {
      expect(isUniqueConstraintViolation(recordNotFoundError)).toBe(false);
    });

    it("is false for an object without a code", () => {
      expect(isUniqueConstraintViolation({ message: "P2002" })).toBe(false);
      expect(isUniqueConstraintViolation(new Error("P2002"))).toBe(false);
    });

    it("is false for values that are not objects", () => {
      expect(isUniqueConstraintViolation("P2002")).toBe(false);
      expect(isUniqueConstraintViolation(2002)).toBe(false);
      expect(isUniqueConstraintViolation(undefined)).toBe(false);
      expect(isUniqueConstraintViolation(null)).toBe(false);
    });
  });

  describe("isRecordNotFound", () => {
    it("is true for an object carrying the P2025 code", () => {
      expect(isRecordNotFound(recordNotFoundError)).toBe(true);
    });

    it("is false for an object carrying a different code", () => {
      expect(isRecordNotFound(uniqueConstraintError)).toBe(false);
    });

    it("is false for an object without a code", () => {
      expect(isRecordNotFound({})).toBe(false);
    });

    it("is false for values that are not objects", () => {
      expect(isRecordNotFound("P2025")).toBe(false);
      expect(isRecordNotFound(null)).toBe(false);
      expect(isRecordNotFound(undefined)).toBe(false);
    });
  });

  describe("websites", () => {
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

    it("createWebsite lets a unique-constraint rejection propagate to the caller", async () => {
      mockWebsiteDelegate.create.mockRejectedValue(uniqueConstraintError);

      await expect(
        createWebsite({ url: "https://example.com", name: "Example" }),
      ).rejects.toBe(uniqueConstraintError);
    });

    it("listWebsites returns only active websites, ordered by createdAt descending", async () => {
      mockWebsiteDelegate.findMany.mockResolvedValue([sampleWebsite]);

      const websites = await listWebsites();

      expect(mockWebsiteDelegate.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      expect(websites).toEqual([sampleWebsite]);
    });

    it("findWebsiteByUrl looks up the active row with that url", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(sampleWebsite);

      const found = await findWebsiteByUrl("https://example.com");

      expect(mockWebsiteDelegate.findFirst).toHaveBeenCalledWith({
        where: { url: "https://example.com", deletedAt: null },
      });
      expect(found).toBe(sampleWebsite);
    });

    it("findWebsiteByUrl returns null when no row matches", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(null);

      expect(await findWebsiteByUrl("https://nope.example")).toBeNull();
    });

    it("findWebsiteById looks up the active row with that id", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(sampleWebsite);

      const found = await findWebsiteById("cuid-1");

      expect(mockWebsiteDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleWebsite);
    });

    it("findWebsiteById returns null when no active row matches", async () => {
      mockWebsiteDelegate.findFirst.mockResolvedValue(null);

      expect(await findWebsiteById("deleted-or-unknown")).toBeNull();
    });

    it("updateWebsite updates only an active row and returns the updated row", async () => {
      const updatedWebsite = { ...sampleWebsite, name: "Renamed" };
      mockWebsiteDelegate.update.mockResolvedValue(updatedWebsite);
      const replacement = { url: "https://example.com/", name: "Renamed", description: null };

      const updated = await updateWebsite("cuid-1", replacement);

      expect(mockWebsiteDelegate.update).toHaveBeenCalledWith({
        where: { id: "cuid-1", deletedAt: null },
        data: replacement,
      });
      expect(updated).toBe(updatedWebsite);
    });

    it("updateWebsite returns null when no active row matched (P2025)", async () => {
      mockWebsiteDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateWebsite("deleted-or-unknown", {
        url: "https://example.com/",
        name: "Example",
      });

      expect(updated).toBeNull();
    });

    it("updateWebsite rethrows a unique-constraint violation (P2002) for the caller to map", async () => {
      mockWebsiteDelegate.update.mockRejectedValue(uniqueConstraintError);

      await expect(
        updateWebsite("cuid-1", { url: "https://taken.example/", name: "Example" }),
      ).rejects.toBe(uniqueConstraintError);
    });

    it("updateWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockWebsiteDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateWebsite("cuid-1", { url: "https://example.com/", name: "Example" }),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteWebsite stamps the website, its use cases, and its actions inside one transaction", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 3 });
      mockActionDelegate.updateMany.mockResolvedValue({ count: 2 });

      const websiteWasDeleted = await softDeleteWebsite("cuid-1");

      expect(websiteWasDeleted).toBe(true);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));
      expect(mockWebsiteDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockUseCaseDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockActionDelegate.updateMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it("softDeleteWebsite writes one shared deletedAt timestamp to all three tables", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 0 });
      mockActionDelegate.updateMany.mockResolvedValue({ count: 0 });
      const millisecondsBeforeCall = Date.now();

      await softDeleteWebsite("cuid-1");

      const millisecondsAfterCall = Date.now();
      const websiteDeletedAt = readDeletedAtWrittenBy(mockWebsiteDelegate.updateMany);
      const useCaseDeletedAt = readDeletedAtWrittenBy(mockUseCaseDelegate.updateMany);
      const actionDeletedAt = readDeletedAtWrittenBy(mockActionDelegate.updateMany);

      expect(websiteDeletedAt).toBeInstanceOf(Date);
      expect(useCaseDeletedAt).toBe(websiteDeletedAt);
      expect(actionDeletedAt).toBe(websiteDeletedAt);
      const deletedAtMilliseconds = (websiteDeletedAt as Date).getTime();
      expect(deletedAtMilliseconds).toBeGreaterThanOrEqual(millisecondsBeforeCall);
      expect(deletedAtMilliseconds).toBeLessThanOrEqual(millisecondsAfterCall);
    });

    it("softDeleteWebsite returns false and touches no children when no active website matched", async () => {
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 0 });

      const websiteWasDeleted = await softDeleteWebsite("deleted-or-unknown");

      expect(websiteWasDeleted).toBe(false);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockUseCaseDelegate.updateMany).not.toHaveBeenCalled();
      expect(mockActionDelegate.updateMany).not.toHaveBeenCalled();
    });

    it("softDeleteWebsite propagates a failure inside the transaction", async () => {
      const childUpdateError = new Error("deadlock detected");
      mockWebsiteDelegate.updateMany.mockResolvedValue({ count: 1 });
      mockUseCaseDelegate.updateMany.mockRejectedValue(childUpdateError);

      await expect(softDeleteWebsite("cuid-1")).rejects.toBe(childUpdateError);
      expect(mockActionDelegate.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("use cases", () => {
    it("listUseCasesForWebsite returns the website's active use cases, newest first", async () => {
      mockUseCaseDelegate.findMany.mockResolvedValue([sampleUseCase]);

      const useCases = await listUseCasesForWebsite("cuid-1");

      expect(mockUseCaseDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      expect(useCases).toEqual([sampleUseCase]);
    });

    it("findUseCaseForWebsite scopes the lookup to the website and to active rows", async () => {
      mockUseCaseDelegate.findFirst.mockResolvedValue(sampleUseCase);

      const found = await findUseCaseForWebsite("cuid-1", "use-case-1");

      expect(mockUseCaseDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "use-case-1", websiteId: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleUseCase);
    });

    it("findUseCaseForWebsite returns null when no active use case of that website matches", async () => {
      mockUseCaseDelegate.findFirst.mockResolvedValue(null);

      expect(await findUseCaseForWebsite("cuid-1", "use-case-of-another-site")).toBeNull();
    });

    it("createUseCaseForWebsite inserts the title and description under the website", async () => {
      mockUseCaseDelegate.create.mockResolvedValue(sampleUseCase);

      const created = await createUseCaseForWebsite("cuid-1", {
        title: "Sign up",
        description: "Create an account",
      });

      expect(mockUseCaseDelegate.create).toHaveBeenCalledWith({
        data: { title: "Sign up", description: "Create an account", websiteId: "cuid-1" },
      });
      expect(created).toBe(sampleUseCase);
    });

    it("updateUseCaseForWebsite updates only an active use case of that website", async () => {
      const updatedUseCase = { ...sampleUseCase, title: "Sign up with Google" };
      mockUseCaseDelegate.update.mockResolvedValue(updatedUseCase);
      const replacement = { title: "Sign up with Google", description: "Use OAuth" };

      const updated = await updateUseCaseForWebsite("cuid-1", "use-case-1", replacement);

      expect(mockUseCaseDelegate.update).toHaveBeenCalledWith({
        where: { id: "use-case-1", websiteId: "cuid-1", deletedAt: null },
        data: replacement,
      });
      expect(updated).toBe(updatedUseCase);
    });

    it("updateUseCaseForWebsite returns null when no active use case matched (P2025)", async () => {
      mockUseCaseDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateUseCaseForWebsite("cuid-1", "missing", {
        title: "t",
        description: "d",
      });

      expect(updated).toBeNull();
    });

    it("updateUseCaseForWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockUseCaseDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateUseCaseForWebsite("cuid-1", "use-case-1", { title: "t", description: "d" }),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteUseCaseForWebsite stamps deletedAt on the active use case of that website", async () => {
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 1 });

      const useCaseWasDeleted = await softDeleteUseCaseForWebsite("cuid-1", "use-case-1");

      expect(useCaseWasDeleted).toBe(true);
      expect(mockUseCaseDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "use-case-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("softDeleteUseCaseForWebsite returns false when no active use case matched", async () => {
      mockUseCaseDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await softDeleteUseCaseForWebsite("cuid-1", "already-deleted")).toBe(false);
    });
  });

  describe("actions", () => {
    it("listActionsForWebsite returns the website's active actions, newest first", async () => {
      mockActionDelegate.findMany.mockResolvedValue([sampleAction]);

      const actions = await listActionsForWebsite("cuid-1");

      expect(mockActionDelegate.findMany).toHaveBeenCalledWith({
        where: { websiteId: "cuid-1", deletedAt: null },
        orderBy: { createdAt: "desc" },
      });
      expect(actions).toEqual([sampleAction]);
    });

    it("findActionForWebsite scopes the lookup to the website and to active rows", async () => {
      mockActionDelegate.findFirst.mockResolvedValue(sampleAction);

      const found = await findActionForWebsite("cuid-1", "action-1");

      expect(mockActionDelegate.findFirst).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
      });
      expect(found).toBe(sampleAction);
    });

    it("findActionForWebsite returns null when no active action of that website matches", async () => {
      mockActionDelegate.findFirst.mockResolvedValue(null);

      expect(await findActionForWebsite("cuid-1", "action-of-another-site")).toBeNull();
    });

    it("createActionForWebsite inserts the title and description under the website", async () => {
      mockActionDelegate.create.mockResolvedValue(sampleAction);

      const created = await createActionForWebsite("cuid-1", {
        title: "Log in",
        description: "Enter credentials and submit",
      });

      expect(mockActionDelegate.create).toHaveBeenCalledWith({
        data: {
          title: "Log in",
          description: "Enter credentials and submit",
          websiteId: "cuid-1",
        },
      });
      expect(created).toBe(sampleAction);
    });

    it("updateActionForWebsite updates only an active action of that website", async () => {
      const updatedAction = { ...sampleAction, title: "Log out" };
      mockActionDelegate.update.mockResolvedValue(updatedAction);
      const replacement = { title: "Log out", description: "Open the menu and log out" };

      const updated = await updateActionForWebsite("cuid-1", "action-1", replacement);

      expect(mockActionDelegate.update).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: replacement,
      });
      expect(updated).toBe(updatedAction);
    });

    it("updateActionForWebsite returns null when no active action matched (P2025)", async () => {
      mockActionDelegate.update.mockRejectedValue(recordNotFoundError);

      const updated = await updateActionForWebsite("cuid-1", "missing", {
        title: "t",
        description: "d",
      });

      expect(updated).toBeNull();
    });

    it("updateActionForWebsite rethrows any other failure unchanged", async () => {
      const connectionError = new Error("connection refused");
      mockActionDelegate.update.mockRejectedValue(connectionError);

      await expect(
        updateActionForWebsite("cuid-1", "action-1", { title: "t", description: "d" }),
      ).rejects.toBe(connectionError);
    });

    it("softDeleteActionForWebsite stamps deletedAt on the active action of that website", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 1 });

      const actionWasDeleted = await softDeleteActionForWebsite("cuid-1", "action-1");

      expect(actionWasDeleted).toBe(true);
      expect(mockActionDelegate.updateMany).toHaveBeenCalledWith({
        where: { id: "action-1", websiteId: "cuid-1", deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("softDeleteActionForWebsite returns false when no active action matched", async () => {
      mockActionDelegate.updateMany.mockResolvedValue({ count: 0 });

      expect(await softDeleteActionForWebsite("cuid-1", "already-deleted")).toBe(false);
    });
  });
});
