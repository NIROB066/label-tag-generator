import { describe, expect, it } from "vitest";
import {
  estimateWrappedLines,
  pickIngredientFontSize,
  pickTitleFontSize,
  TITLE_BOX_WIDTH_PT,
  TITLE_FONT_MAX_HALF_POINTS,
  TITLE_FONT_MIN_HALF_POINTS,
  INGREDIENTS_FONT_MAX_HALF_POINTS,
  INGREDIENTS_FONT_MIN_HALF_POINTS,
} from "@/domain/label-typography";

describe("estimateWrappedLines", () => {
  it("returns 0 lines for empty or whitespace-only text", () => {
    expect(estimateWrappedLines("", 42, TITLE_BOX_WIDTH_PT)).toBe(0);
    expect(estimateWrappedLines("   ", 42, TITLE_BOX_WIDTH_PT)).toBe(0);
  });

  it("wraps the template title across two lines at the template size", () => {
    expect(estimateWrappedLines("Lava Cake 3 Inch", 42, TITLE_BOX_WIDTH_PT)).toBe(2);
  });

  it("wraps a long product name across multiple lines at the template size", () => {
    expect(
      estimateWrappedLines(
        "Chocolate Raspberry Cheesecake Dessert Cups",
        42,
        TITLE_BOX_WIDTH_PT,
      ),
    ).toBe(5);
  });

  it("counts a word longer than the line as multiple lines", () => {
    expect(estimateWrappedLines("abcdefghijklmnopqrstuvwxyz", 42, 40)).toBeGreaterThanOrEqual(5);
  });
});

describe("pickTitleFontSize", () => {
  it("keeps the template size for short names", () => {
    expect(pickTitleFontSize("Lava Cake 3 Inch")).toBe(TITLE_FONT_MAX_HALF_POINTS);
  });

  it("shrinks a two-word-boundary name only as much as needed", () => {
    // The 1.6" usable title box cannot hold this 43-char name on two lines
    // above the 10pt readability floor.
    expect(pickTitleFontSize("Chocolate Raspberry Cheesecake Dessert Cups")).toBe(20);
  });

  it("shrinks a long real-world name to two lines instead of overflowing", () => {
    const size = pickTitleFontSize("IRHU moni chocolate khabe chowar sathe");
    expect(size).toBe(22);
    expect(estimateWrappedLines("IRHU moni chocolate khabe chowar sathe", size, TITLE_BOX_WIDTH_PT)).toBeLessThanOrEqual(2);
  });

  it("shrinks further for very long names but never below the floor", () => {
    const size = pickTitleFontSize(
      "Chocolate Raspberry Cheesecake Dessert Cups with Whipped Cream Topping",
    );
    expect(size).toBe(20);
    expect(size).toBeGreaterThanOrEqual(TITLE_FONT_MIN_HALF_POINTS);
  });

  it("clamps to the minimum size for extreme names", () => {
    const size = pickTitleFontSize("x".repeat(200));
    expect(size).toBe(TITLE_FONT_MIN_HALF_POINTS);
  });

  it("never increases the size and always keeps the name within two lines when possible", () => {
    const names = [
      "Lava Cake 3 Inch",
      "Raspberry Cheesecake",
      "Chocolate Raspberry Cheesecake Dessert Cups",
      "Chocolate Raspberry Cheesecake Dessert Cups with Whipped Cream Topping",
      "x".repeat(120),
    ];
    for (const name of names) {
      const size = pickTitleFontSize(name);
      expect(size).toBeLessThanOrEqual(TITLE_FONT_MAX_HALF_POINTS);
      expect(size).toBeGreaterThanOrEqual(TITLE_FONT_MIN_HALF_POINTS);
      if (size > TITLE_FONT_MIN_HALF_POINTS) {
        expect(estimateWrappedLines(name, size, TITLE_BOX_WIDTH_PT)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("pickIngredientFontSize", () => {
  it("keeps the template size for short ingredient lists", () => {
    expect(pickIngredientFontSize("Eggs, sugar.")).toBe(INGREDIENTS_FONT_MAX_HALF_POINTS);
    expect(pickIngredientFontSize("x".repeat(120))).toBe(INGREDIENTS_FONT_MAX_HALF_POINTS);
  });

  it("steps down at each threshold", () => {
    expect(pickIngredientFontSize("x".repeat(121))).toBe(18);
    expect(pickIngredientFontSize("x".repeat(280))).toBe(18);
    expect(pickIngredientFontSize("x".repeat(281))).toBe(16);
    expect(pickIngredientFontSize("x".repeat(400))).toBe(16);
    expect(pickIngredientFontSize("x".repeat(401))).toBe(14);
    expect(pickIngredientFontSize("x".repeat(520))).toBe(14);
    expect(pickIngredientFontSize("x".repeat(521))).toBe(12);
  });

  it("never drops below the readability floor", () => {
    expect(pickIngredientFontSize("x".repeat(5000))).toBe(INGREDIENTS_FONT_MIN_HALF_POINTS);
  });

  it("is monotonically non-increasing as the declaration grows", () => {
    let previous = pickIngredientFontSize("x");
    for (let length = 10; length <= 900; length += 10) {
      const size = pickIngredientFontSize("x".repeat(length));
      expect(size).toBeLessThanOrEqual(previous);
      previous = size;
    }
  });
});
