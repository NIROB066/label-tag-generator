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
  normalizeIngredientsSpacing,
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

describe("estimateWrappedLines word breaking", () => {
  it("keeps a word whole when it fits within a full line", () => {
    // 30pt box at 10pt gives floor(30 / (10 * 0.55)) = 5 chars per line, so
    // "Dark" (4 chars) must stay on one line even at the right box edge.
    expect(estimateWrappedLines("Dark", 20, 30)).toBe(1);
  });

  it("moves a trailing word wholly to the next line instead of splitting it", () => {
    // 44pt box at 10pt = 8 chars per line: "Eggs Dark" (9 chars) wraps as
    // "Eggs" / "Dark" — never "Eggs D" / "ark" with "D" left behind.
    expect(estimateWrappedLines("Eggs Dark", 20, 44)).toBe(2);
    // 50pt box at 10pt = 9 chars per line: the full text fits one line.
    expect(estimateWrappedLines("Eggs Dark", 20, 50)).toBe(1);
  });

  it("only breaks a word across lines when it is longer than a whole line", () => {
    // 8 chars per line: a 12-character ingredient word occupies 2 lines.
    expect(estimateWrappedLines("blackcurrant", 20, 44)).toBe(2);
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
    expect(size).toBe(24);
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

describe("normalizeIngredientsSpacing", () => {
  it("inserts a single space after commas with no following space", () => {
    expect(normalizeIngredientsSpacing("Eggs,sugar,wheat flour")).toBe("Eggs, sugar, wheat flour");
  });

  it("leaves commas that already have a space untouched", () => {
    expect(normalizeIngredientsSpacing("Eggs, sugar, wheat flour")).toBe(
      "Eggs, sugar, wheat flour",
    );
  });

  it("handles mixed spacing across the declaration", () => {
    expect(normalizeIngredientsSpacing("Eggs, sugar,wheat flour,margarine")).toBe(
      "Eggs, sugar, wheat flour, margarine",
    );
  });

  it("does not append a space when the comma ends the text", () => {
    expect(normalizeIngredientsSpacing("Eggs, sugar,")).toBe("Eggs, sugar,");
  });

  it("leaves text without commas and empty text unchanged", () => {
    expect(normalizeIngredientsSpacing("Wheat flour")).toBe("Wheat flour");
    expect(normalizeIngredientsSpacing("")).toBe("");
  });

  it("adds a space after a closing parenthesis followed by a word", () => {
    expect(normalizeIngredientsSpacing("Milk (pasteurized)sugar")).toBe(
      "Milk (pasteurized) sugar",
    );
    expect(normalizeIngredientsSpacing("(a)(b)")).toBe("(a) (b)");
  });

  it("does not add a space between a closing parenthesis and a comma", () => {
    expect(normalizeIngredientsSpacing("Milk (pasteurized),sugar")).toBe(
      "Milk (pasteurized), sugar",
    );
    expect(normalizeIngredientsSpacing("Milk (pasteurized), sugar")).toBe(
      "Milk (pasteurized), sugar",
    );
  });

  it("leaves a closing parenthesis followed by whitespace or end of text unchanged", () => {
    expect(normalizeIngredientsSpacing("Milk (pasteurized) sugar")).toBe(
      "Milk (pasteurized) sugar",
    );
    expect(normalizeIngredientsSpacing("Milk (pasteurized)")).toBe("Milk (pasteurized)");
  });

  it("does not add a space after an empty parenthesis pair", () => {
    expect(normalizeIngredientsSpacing("Milk()sugar")).toBe("Milk ()sugar");
  });

  it("does not add a space after a closing parenthesis preceded by a non-letter", () => {
    expect(normalizeIngredientsSpacing("Salt (2%)sugar")).toBe("Salt (2%)sugar");
    expect(normalizeIngredientsSpacing("E330(2%)salt")).toBe("E330(2%)salt");
  });

  it("keeps nested closing parentheses glued together", () => {
    expect(normalizeIngredientsSpacing("(E160a(ii)))")).toBe("(E160a (ii)))");
    expect(normalizeIngredientsSpacing("Colour (E160a(ii)),sugar")).toBe(
      "Colour (E160a (ii)), sugar",
    );
  });

  it("adds a space before an opening parenthesis preceded by a letter", () => {
    expect(normalizeIngredientsSpacing("Milk(pasteurized),sugar")).toBe(
      "Milk (pasteurized), sugar",
    );
    expect(normalizeIngredientsSpacing("Milk(pasteurized)sugar")).toBe(
      "Milk (pasteurized) sugar",
    );
  });

  it("leaves an opening parenthesis unchanged when not preceded by a letter", () => {
    expect(normalizeIngredientsSpacing("Milk (pasteurized)")).toBe("Milk (pasteurized)");
    expect(normalizeIngredientsSpacing("(pasteurized) milk")).toBe("(pasteurized) milk");
    expect(normalizeIngredientsSpacing("4(pasteurized)")).toBe("4(pasteurized)");
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
