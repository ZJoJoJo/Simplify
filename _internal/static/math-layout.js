"use strict";

// Only top-level addition/subtraction may break. Signs, fractions, exponents
// and parenthesized factors remain intact, so formatting preserves the math.
globalThis.MathLayout = (() => {
  function splitSum(source) {
    const parts=[];
    let braces=0, parentheses=0, brackets=0, start=0;
    for (let i=0;i<source.length;i++) {
      const c=source[i];
      if (c === "\\") {
        const command=source.slice(i).match(/^\\(?:[a-zA-Z]+|.)/);
        if (command) { i+=command[0].length-1; continue; }
      }
      if (c === "{") braces++;
      else if (c === "}") braces--;
      else if (c === "(") parentheses++;
      else if (c === ")") parentheses--;
      else if (c === "[") brackets++;
      else if (c === "]") brackets--;
      else if ((c === "+" || c === "-") && !braces && !parentheses && !brackets && source.slice(start,i).trim()) {
        parts.push(source.slice(start,i).trim()); start=i;
      }
    }
    if (source.slice(start).trim()) parts.push(source.slice(start).trim());
    return parts;
  }
  function flattenEquation(source) {
    return source.replace(/^\\begin\{aligned\}/, "").replace(/\\end\{aligned\}$/, "")
      .replace(/\\\\\s*&?\s*\\quad\s*\{\}/g, " ").replace(/&/g, "").trim();
  }
  function wrapEquation(source, maxWidth, measure) {
    const flat=flattenEquation(source), equal=flat.indexOf("=");
    if (equal < 0) return flat;
    const label=flat.slice(0,equal).trim(), expression=flat.slice(equal+1).trim();
    const chunks=[]; let chunk="";
    for (const term of splitSum(expression)) {
      const candidate=chunk ? chunk+" "+term : term;
      if (chunk && measure(label+" = "+candidate) > maxWidth) { chunks.push(chunk); chunk=term; }
      else chunk=candidate;
    }
    if (chunk) chunks.push(chunk);
    if (chunks.length < 2) return flat;
    return "\\begin{aligned}\n"+chunks.map((c,i)=>i ? "&\\quad {}"+c : label+" &= "+c).join(" \\\\\n")+"\n\\end{aligned}";
  }
  function fractionParts(source) {
    let text=source.trim(), sign="";
    if (text.startsWith("-")) { sign="-"; text=text.slice(1).trim(); }
    if (!text.startsWith("\\frac{")) return null;
    let i=5;
    function group() {
      if (text[i] !== "{") return null;
      let depth=0; const start=++i;
      for (;i<text.length;i++) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") {
          if (!depth) { const result=text.slice(start,i); i++; return result; }
          depth--;
        }
      }
      return null;
    }
    const numerator=group(), denominator=group();
    // The leading minus must apply to the whole numerator, not its first term.
    return numerator!==null && denominator!==null && !text.slice(i).trim() ? {numerator:sign ? "-\\left("+numerator+"\\right)" : numerator,denominator} : null;
  }
  function combine(main, definitions) {
    return definitions.length ? "\\begin{gathered}\n"+[main,...definitions].join(" \\\\[6pt]\n")+"\n\\end{gathered}" : main;
  }
  return Object.freeze({splitSum,flattenEquation,wrapEquation,fractionParts,combine});
})();
