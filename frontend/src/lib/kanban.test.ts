import { createId, moveCard, type Column } from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });

  it("drops a card onto an empty column", () => {
    const columns: Column[] = [
      { id: "col-a", title: "A", cardIds: ["card-1"] },
      { id: "col-b", title: "B", cardIds: [] },
    ];
    const result = moveCard(columns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual([]);
    expect(result[1].cardIds).toEqual(["card-1"]);
  });

  it("moves a card to the end within the same column when dropped on the column itself", () => {
    const result = moveCard(baseColumns, "card-1", "col-a");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("is a no-op when active and over resolve to the same position", () => {
    const result = moveCard(baseColumns, "card-1", "card-1");
    expect(result).toBe(baseColumns);
  });

  it("is a no-op when the active id cannot be found", () => {
    const result = moveCard(baseColumns, "missing-card", "card-1");
    expect(result).toBe(baseColumns);
  });

  it("is a no-op when the over id cannot be found", () => {
    const result = moveCard(baseColumns, "card-1", "missing-card");
    expect(result).toBe(baseColumns);
  });
});

describe("createId", () => {
  it("prefixes the id", () => {
    expect(createId("card")).toMatch(/^card-/);
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId("card")));
    expect(ids.size).toBe(1000);
  });
});
