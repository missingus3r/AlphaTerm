import { describe, expect, it } from "vitest";
import { countChanges, parseDiff, sideBySide } from "./diff";

const DIFF = `diff --git a/a.txt b/a.txt
index 1111..2222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,4 @@
 uno
-dos
-tres
+DOS
 cuatro
\\ No newline at end of file
`;

describe("diff", () => {
  it("numera las líneas viejas y nuevas", () => {
    const l = parseDiff(DIFF);
    expect(l.filter((x) => x.kind === "meta").map((x) => x.text)).toEqual([
      "diff --git a/a.txt b/a.txt", "index 1111..2222 100644", "--- a/a.txt", "+++ b/a.txt", "\\ No newline at end of file",
    ]);
    const body = l.filter((x) => x.kind !== "meta" && x.kind !== "hunk");
    expect(body).toEqual([
      { kind: "ctx", text: "uno", oldNo: 1, newNo: 1 },
      { kind: "del", text: "dos", oldNo: 2 },
      { kind: "del", text: "tres", oldNo: 3 },
      { kind: "add", text: "DOS", newNo: 2 },
      { kind: "ctx", text: "cuatro", oldNo: 4, newNo: 3 },
    ]);
    expect(countChanges(l)).toEqual({ add: 1, del: 2 });
  });

  it("lado a lado empareja borrados y agregados", () => {
    const rows = sideBySide(parseDiff(DIFF)).filter((r) => !r.full);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ["uno", "uno"],
      ["dos", "DOS"],
      ["tres", null],
      ["cuatro", "cuatro"],
    ]);
  });

  it("archivo nuevo (sin seguimiento)", () => {
    const l = parseDiff("diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\n+++ b/x\n@@ -0,0 +1,2 @@\n+a\n+b\n");
    expect(countChanges(l)).toEqual({ add: 2, del: 0 });
    expect(l.filter((x) => x.kind === "add").map((x) => x.newNo)).toEqual([1, 2]);
  });
});
