// Worked example: why parser compliance matters. One input, three sanitizers, then what a browser makes of each output.
//   node bench/mxss-example.mjs
import { make } from "./contenders.mjs";
import { reparse, liveHandlers } from "./reparse.mjs";
import { serialize } from "parse5";

const input = `<xmp><p title="</xmp><img src=x onerror=alert(1)>">`;
console.log("input:\n  " + input + "\n");
for (const name of ["isomorphic-dompurify", "linkedom", "purify-edge"]) {
  const out = (await make(name)).sanitize(input);
  console.log(`${name}\n  output:      ${JSON.stringify(out)}`);
  console.log(`  re-parsed:   ${serialize(reparse(out))}`);
  const live = liveHandlers(out);
  console.log("  live on*:    " + (live.length ? live.map((h) => `<${h.tag} ${h.attr}="${h.value}">`).join(" ") : "none") + "\n");
}

// Control: the same linkedom setup on a payload with no parsing subtlety at all.
const control = `<img src=x onerror=alert(1)>`;
console.log("control input: " + control);
for (const name of ["linkedom", "purify-edge"]) console.log(`  ${name.padEnd(12)} ${JSON.stringify((await make(name).then((c) => c)).sanitize(control))}`);
