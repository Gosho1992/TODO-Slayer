import assert from "node:assert/strict";
import { detect } from "../api/_detect.js";

const types = (src, path = "a.js") => detect(src, path).map((f) => f.type);
const ok = (src, expected, path) => assert.deepEqual(types(src, path), expected, `${path || "a.js"}: ${JSON.stringify(src)}`);

// --- Must match ---
ok("// TODO: implement auth", ["TODO"]);
ok("# FIXME handle null", ["FIXME"], "a.py");
ok("/* HACK: temp */", ["HACK"]);
ok("x = 1  # XXX fragile", ["HACK"], "a.py");
ok("// In a real application you would validate this", ["PLACEHOLDER"]);
ok("# for now, use mock data", ["PLACEHOLDER"], "a.py");
ok("    raise NotImplementedError", ["STUB"], "a.py");
ok('throw new Error("Not implemented")', ["STUB"]);
ok("try { a() } catch (e) {}", ["SILENT"]);
ok("try { a() } catch {\n}", ["SILENT"]);
ok("try:\n    g()\nexcept Exception:\n    pass", ["SILENT"], "a.py");
ok('const url = "https://x.com"; // TODO: move to env', ["TODO"]);           // real comment after a string with //
ok("/*\n * Big header\n * TODO: split this file\n */", ["TODO"]);           // inside a multi-line block comment
ok("<!-- TODO: add alt text -->", ["TODO"], "a.html");
ok("-- TODO: add index", ["TODO"], "a.sql");
ok("/* FIXME: z-index war */", ["FIXME"], "a.css");
ok("<template>\n<!-- TODO: empty state -->\n</template>", ["TODO"], "a.vue");
ok("let c = 'x'; // FIXME", ["FIXME"], "a.rs");

// --- Must NOT match ---
ok("const todoList = [];", []);
ok('const s = "TODO in a string";', []);
ok('const url = "https://example.com/TODO";', []);                         // reviewer's case
ok('const url = "https://example.com/FIXME";', []);
ok('x = "abc#TODO"', [], "a.py");                                          // reviewer's case
ok("const tag = `// TODO not a comment`;", []);                              // template literal
ok("const s = 'it\\'s // TODO';", []);                                       // escaped quote
ok("#TODO { color: red }", [], "a.css");                                    // CSS id selector, not a comment
ok("const color = '#TODO';", []);
ok('throw new Error("Not implemented") ', ["STUB"]);                        // sanity: still a stub
ok('// throw new Error("Not implemented")', []);                            // commented-out stub isn't a stub
ok("try { a() } catch (e) { log(e) }", []);
ok("except ValueError:\n    return None", [], "a.py");
ok('msg = "for now, use mock data"', [], "a.py");                           // placeholder words in a string
ok("const fixme = 1; // nothing here", []);

// --- Real-world false positives (found scanning npm + Python stdlib) ---
ok("try:\n    g()\nexcept:\n    pass", ["SILENT"], "a.py");                         // bare except: still a monster
ok("except FileNotFoundError:\n    pass", [], "a.py");                                 // narrow + deliberate idiom
ok("except OSError: pass", [], "a.py");
ok("try { a() } catch (e) { /* ignore: optional file */ }", []);                       // documented swallow
ok("class BaseLoop:\n    def run(self):\n        raise NotImplementedError", [], "a.py"); // interface method
ok("class Store(ABC):\n    def get(self):\n        raise NotImplementedError", [], "a.py");
ok("    @abstractmethod\n    def area(self):\n        raise NotImplementedError", [], "a.py");
ok("class Payments:\n    def refund(self):\n        raise NotImplementedError", ["STUB"], "a.py"); // concrete class: real stub

console.log("detect: all tests passed");
