"use strict";

const $ = id => document.getElementById(id);
const examples = {
  user: {
    equations: String.raw`V_{i}*g_{m1}+V_{1}/r_{o1}+V_{1}*g_{m2}+(V_{1}-V_{x})/r_{o2}=0
V_{1}*g_{m2}+(V_{1}-V_{x})/r_{o2}-V_{y}*g_{m3}+(V_{x}-V_{y})/r_{o3}=0
V_{y}*g_{m3}+(V_{y}-V_{x})/r_{o3}+V_{y}/r_{o4}=(V_{o}-V_{y})*S*C_{C}
(V_{o}-V_{y})*S*C_{C}+V_{o}/R_{2}+V_{o}*S*C_{2}=-V_{x}*g_{m5}
(V_{o}-V_{y})*S*C_{C}+V_{o}/R_{2}+V_{o}*S*C_{2}=-V_{x}*g_{m5}`,
    target: "V_{o}/V_{i}", unknowns: ["V_1", "V_x", "V_y", "V_o"], frequency: "S"
  },
  cs: {equations: String.raw`g_{m}*V_{i}+V_{o}/r_{o}+V_{o}/R_{D}+S*C_{L}*V_{o}=0`, target: "V_{o}/V_{i}", unknowns: ["V_o"], frequency: "S"},
  rc: {equations: String.raw`(V_{x}-V_{i})/R_{1}+(V_{x}-V_{o})/R_{2}+S*C_{1}*V_{x}=0
(V_{o}-V_{x})/R_{2}+S*C_{2}*V_{o}=0`, target: "V_{o}/V_{i}", unknowns: ["V_x", "V_o"], frequency: "S"},
  blank: {equations: "", target: "V_{o}/V_{i}", unknowns: [], frequency: "S"}
};
let token, symbols = [], selected = new Set(), analysis = null, result = null;
let revision = 0, analysisSequence = 0, timer, currentForm = "factor", valid = false, busy = false, toastTimer;
let fitOutput=true, currentKatex="", expandedKatex="", resizeTimer;
const measureElement=document.createElement("span");
measureElement.className="math-measure";
document.body.append(measureElement);

function toast(text) {
  $("toast").textContent = text; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").hidden = true, 3000);
}
function normalize(text) { return text.replace(/_([a-zA-Z0-9]+)/g, "_{$1}"); }
function displaySource(text) { return normalize(text).replace(/\*\*/g, "^").replace(/\*/g, "\\cdot "); }
function renderMath(text, element, displayMode = false) {
  try {
    katex.render(text, element, {displayMode, throwOnError: true, trust: false, strict: "ignore", maxExpand: 150, maxSize: 20});
    element.classList.remove("parse-error"); return true;
  } catch (error) {
    element.textContent = error.message.replace("KaTeX parse error: ", "");
    element.classList.add("parse-error"); return false;
  }
}
function sourceLines() {
  return $("equations").value.replace(/\\(?:begin|end)\{(?:aligned|align\*?|cases|gathered)\}/g, "").replace(/\\\\/g, "\n").replace(/;/g, "\n").replace(/&/g, "").split("\n").map((line, i) => ({text:line.split("%")[0].trim(), number:i+1})).filter(x => x.text);
}
function updatePreview() {
  const rows = sourceLines();
  $("lineCount").textContent = `${rows.length} 条方程`;
  $("gutter").textContent = $("equations").value.split("\n").map((_, i) => String(i+1).padStart(2,"0")).join("\n");
  $("preview").replaceChildren();
  if (!rows.length) { const e = document.createElement("p"); e.className="preview-empty"; e.textContent="输入第一条方程，公式将在这里实时显示"; $("preview").append(e); }
  for (const row of rows.slice(0,24)) {
    const element = document.createElement("div"); element.className="preview-row";
    const number = document.createElement("span"); number.className="eq-number"; number.textContent = String(row.number).padStart(2,"0");
    const formula = document.createElement("div"); formula.className="preview-formula";
    renderMath(displaySource(row.text), formula, true); element.append(number, formula); $("preview").append(element);
  }
  renderMath(displaySource($("target").value), $("targetPreview"));
}
async function api(action, payload) {
  const response = await fetch(`/api/${action}`, {method:"POST", headers:{"Content-Type":"application/json", "X-App-Token":token}, body:JSON.stringify(payload)});
  const json = await response.json();
  if (!json.ok) throw new Error(json.error || "计算服务暂不可用。");
  return json.data;
}
function payload() { return {equations:$("equations").value, target:$("target").value, unknowns:[...selected], frequency:$("frequency").value}; }
function updateButtons() { $("solveBtn").disabled = busy || !valid || !selected.size; }
function updateParameters() {
  const params = symbols.filter(s => !selected.has(s.name));
  $("parameterSummary").textContent = `已选 ${selected.size} 个未知量 · 其余 ${params.length} 个符号保留为参数（含输入信号）`;
  updateButtons();
}
function inputSymbols() {
  const normalized = $("target").value.replace(/[{}]/g, "");
  const denominator = normalized.includes("/") ? normalized.split("/").slice(1).join("/") : "";
  const frac = $("target").value.match(/\\(?:d?frac|tfrac)\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/);
  return new Set(symbols.filter(s => denominator.includes(s.name) || (frac && frac[1].replace(/[{}]/g, "").includes(s.name)) || /^(?:[vViI]_(?:i|in|input)|[vV]in)$/i.test(s.name)).map(s => s.name));
}
function suggest() {
  const inputs = inputSymbols();
  selected = new Set(symbols.filter(s => /^(?:[vViI](?:_|[0-9]|$)|[vViI](?:out|x|y|o)$)/.test(s.name) && !inputs.has(s.name)).map(s => s.name));
}
function drawVariables() {
  $("variables").replaceChildren();
  for (const symbol of symbols) {
    const label = document.createElement("label"); label.className="var-chip"; label.title=`${symbol.name}：勾选后参与求解`;
    const input = document.createElement("input"); input.type="checkbox"; input.checked=selected.has(symbol.name); input.setAttribute("aria-label",`求解 ${symbol.name}`);
    input.addEventListener("change", () => { input.checked ? selected.add(symbol.name) : selected.delete(symbol.name); markChanged(); updateParameters(); });
    const formula = document.createElement("span"); renderMath(symbol.latex, formula); label.append(input, formula); $("variables").append(label);
  }
  updateParameters();
}
function markChanged() {
  revision++;
  if (result) {
    $("verified").textContent="输入或设置已更改，当前显示的是上一次结果，请重新求解。";
    $("verified").classList.add("stale"); $("resultStatus").textContent="结果待更新";
    $("copyBtn").disabled=true; $("copyExpandedBtn").disabled=true; $("exportBtn").disabled=true;
  }
  $("solveError").hidden=true;
  try { localStorage.setItem("smallsignal-draft", JSON.stringify(payload())); } catch (_) {}
}
async function analyzeNow() {
  const sequence = ++analysisSequence;
  if (!$("equations").value.trim()) { valid=false; symbols=[]; selected.clear(); drawVariables(); $("parseStatus").textContent="等待输入"; $("inputNotice").hidden=true; return; }
  $("parseStatus").textContent="识别中…"; $("parseStatus").classList.remove("error");
  try {
    const data = await api("analyze", {equations:$("equations").value});
    if (sequence !== analysisSequence) return;
    analysis=data; symbols=data.symbols; valid=true;
    selected = new Set([...selected].filter(x => symbols.some(s => s.name === x)));
    drawVariables();
    $("parseStatus").textContent="语法检查通过"; $("parseStatus").classList.remove("error");
    const notes=[];
    if (data.duplicates.length) notes.push(`第 ${data.duplicates.join("、")} 行是重复方程，求解时自动去重；重复方程不能增加独立约束。`);
    if (symbols.some(s => /^SC_/.test(s.name))) notes.push("检测到 SC 下标符号：如表示 S 与电容相乘，请明确写成 S*C_{2}。");
    $("inputNotice").textContent=notes.join(" "); $("inputNotice").hidden=!notes.length;
  } catch(error) {
    if (sequence !== analysisSequence) return;
    valid=false; $("parseStatus").textContent="请检查输入"; $("parseStatus").classList.add("error");
    $("inputNotice").textContent=error.message; $("inputNotice").hidden=false;
  }
  updateButtons();
}
function queueAnalysis() {
  analysisSequence++; valid=false; updateButtons(); clearTimeout(timer);
  if (token) timer=setTimeout(analyzeNow, 500);
}
function measureFormula(source, fontSize=13) {
  measureElement.style.fontSize=`${fontSize}px`;
  renderMath(source,measureElement);
  return measureElement.getBoundingClientRect().width;
}
function drawOutputMath(container, source) {
  const viewport=document.createElement("div"); viewport.className="math-viewport";
  const content=document.createElement("div"); content.className="math-content";
  renderMath(source,content,true); viewport.append(content); container.replaceChildren(viewport);
}
function fitResultMath() {
  document.querySelector(".result-panel").classList.toggle("unfitted",!fitOutput);
  for (const viewport of document.querySelectorAll(".result-panel .math-viewport")) {
    const content=viewport.firstElementChild;
    const available=viewport.clientWidth;
    if (!available) continue;
    content.style.transform="none"; content.style.marginLeft="0";
    const width=content.offsetWidth, height=content.offsetHeight;
    const scale=fitOutput && width ? Math.min(1,available/width) : 1;
    content.style.transform=`scale(${scale})`;
    viewport.style.height=`${Math.ceil(height*scale)+2}px`;
    if (viewport.parentElement.id === "resultMath" && width*scale < available) content.style.marginLeft=`${(available-width*scale)/2}px`;
  }
}
function renderResult() {
  if (!result) return;
  const form = result.forms[currentForm];
  expandedKatex=`${result.target_latex} = ${form.latex}`;
  let displayEquation=`${result.target_latex} = ${form.display_latex || form.latex}`;
  let definitions=(form.coefficients || []).map(c=>MathLayout.flattenEquation(c.latex));
  const panelWidth=document.querySelector(".result-panel").clientWidth;
  const fullWidth=Math.max(180,panelWidth-64), halfWidth=Math.max(160,(panelWidth-84)/2);
  if (!definitions.length && measureFormula(displayEquation,15)>fullWidth) {
    const parts=MathLayout.fractionParts(form.latex);
    if (parts) {
      displayEquation=`${result.target_latex} = \\frac{\\mathcal{N}}{\\mathcal{D}}`;
      definitions=[`\\mathcal{N} = ${parts.numerator}`,`\\mathcal{D} = ${parts.denominator}`];
    } else displayEquation=MathLayout.wrapEquation(displayEquation,fullWidth,s=>measureFormula(s,15));
  }
  drawOutputMath($("resultMath"),displayEquation);
  $("coefficientBlock").hidden=!definitions.length;
  $("coefficients").replaceChildren();
  const rows=definitions.map(source=>({source,wide:measureFormula(source)>halfWidth || source.length>180})).sort((a,b)=>Number(a.wide)-Number(b.wide));
  const formatted=[];
  for (const row of rows) {
    const element=document.createElement("div"); element.className="coefficient-card"+(row.wide ? " wide" : "");
    const width=row.wide || panelWidth<600 ? fullWidth : halfWidth;
    const source=MathLayout.wrapEquation(row.source,width,s=>measureFormula(s));
    formatted.push(source); drawOutputMath(element,source); $("coefficients").append(element);
  }
  currentKatex=MathLayout.combine(displayEquation,formatted);
  // Validate the exact clipboard string with the same bundled KaTeX renderer.
  katex.renderToString(currentKatex,{throwOnError:true,trust:false,strict:"ignore"});
  $("latexCode").value=currentKatex;
  document.querySelectorAll("[data-form]").forEach(b => b.classList.toggle("active", b.dataset.form === currentForm));
  fitResultMath();
}
async function solve() {
  if (busy || !valid || !selected.size) return;
  busy=true; const atRevision=revision; const request=payload(); updateButtons();
  $("copyBtn").disabled=true; $("copyExpandedBtn").disabled=true; $("exportBtn").disabled=true;
  $("solveBtn").classList.add("loading"); $("solveLabel").textContent="正在符号消元…";
  $("solveError").hidden=true; $("resultStatus").textContent="计算与代回校验中";
  try {
    const data=await api("solve", request);
    if (atRevision !== revision) { toast("计算期间输入已更改，请重新求解。"); $("resultStatus").textContent="输入已更改"; return; }
    result=data; if (data.forms.frequency.display_latex) currentForm="frequency";
    $("emptyState").hidden=true; $("resultContent").hidden=false;
    $("resultStatus").textContent=`秩 ${data.rank} / ${data.unknown_count}`;
    $("verified").classList.remove("stale");
    $("verified").textContent=`✓ 已精确代回 ${data.checked_count} 条原方程，残差全部为 0`;
    $("copyBtn").disabled=false; $("copyExpandedBtn").disabled=false; $("exportBtn").disabled=false;
    $("conditions").replaceChildren();
    for (const item of data.conditions) { const e=document.createElement("div"); renderMath(item.latex,e); $("conditions").append(e); }
    $("conditionCount").textContent=`${data.conditions.length} 项`;
    $("conditionsDetails").open=false;
    $("solutions").replaceChildren();
    for (const item of data.solutions) { const e=document.createElement("div"); renderMath(item.latex,e); $("solutions").append(e); }
    $("eliminationNote").textContent=`已消去：${data.eliminated.join("、") || "无中间变量"}。${data.free_variables.length ? `系统存在自由变量 ${data.free_variables.join("、")}，但目标表达式可以唯一确定。` : "所选未知量在列出的通用参数条件下有唯一解。"}${data.duplicates.length ? `第 ${data.duplicates.join("、")} 行重复，已去重。` : ""}`;
    renderMath(data.matrix_latex, $("matrix"), true); $("timing").textContent=`精确计算 ${data.elapsed.toFixed(2)} s`;
    renderResult();
  } catch(error) {
    if (atRevision !== revision) { $("resultStatus").textContent="输入已更改"; return; }
    $("solveError").textContent=error.message; $("solveError").hidden=false;
    $("resultContent").hidden=true; $("emptyState").hidden=true; $("resultStatus").textContent="未得到有效结果";
    result=null; currentKatex=""; expandedKatex="";
    $("copyBtn").disabled=true; $("copyExpandedBtn").disabled=true;
  } finally { busy=false; $("solveBtn").classList.remove("loading"); $("solveLabel").textContent="消元并化简"; updateButtons(); }
}
function setProject(project) {
  if (!project || typeof project.equations !== "string" || typeof project.target !== "string" || !Array.isArray(project.unknowns) || !project.unknowns.every(x => typeof x === "string") || (project.frequency !== undefined && typeof project.frequency !== "string") || project.equations.length > 14000) throw new Error("不是有效的 SmallSignal 项目文件。");
  $("equations").value=project.equations; $("target").value=project.target; $("frequency").value=project.frequency ?? "S";
  selected=new Set(project.unknowns); symbols=[]; result=null; analysis=null;
  $("copyBtn").disabled=true; $("copyExpandedBtn").disabled=true;
  $("resultContent").hidden=true; $("emptyState").hidden=false; $("resultStatus").textContent="等待求解";
  markChanged(); updatePreview(); queueAnalysis();
}
function download(content, name, type) {
  const url=URL.createObjectURL(new Blob([content], {type})); const a=document.createElement("a");
  a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
}
async function copyResult(expanded=false) {
  if (!result || $("copyBtn").disabled) return;
  const source=expanded ? expandedKatex : currentKatex;
  try {
    katex.renderToString(source,{throwOnError:true,trust:false,strict:"ignore"});
    await navigator.clipboard.writeText(source);
    toast(expanded ? "已复制完整展开式，可直接用于 KaTeX" : "已复制 KaTeX 公式（包含全部系数定义）");
  }
  catch (_) {
    // Older embedded webviews may lack Clipboard API access. A selected
    // textarea + copy command keeps the action one-click on those engines.
    const textarea=$("latexCode"); textarea.closest("details").open=true;
    textarea.value=source; textarea.focus(); textarea.select();
    const copied=document.execCommand("copy");
    toast(copied ? "已复制 KaTeX 公式" : "请按 Ctrl+C 复制已选中的 KaTeX 公式");
  }
}
function exportRecord() {
  if (!result) return;
  download(currentKatex,"SmallSignal-公式.katex.txt","text/plain;charset=utf-8");
}
function toggleFocus(force) {
  const panel=document.querySelector(".result-panel");
  const expanded=force ?? !panel.classList.contains("expanded");
  panel.classList.toggle("expanded",expanded); document.body.classList.toggle("focus-result",expanded);
  $("focusBtn").textContent=expanded ? "返回工作台" : "展开结果";
  $("focusBtn").setAttribute("aria-pressed",String(expanded));
  if (result) renderResult();
}
$("equations").addEventListener("input", () => { markChanged(); updatePreview(); queueAnalysis(); });
$("equations").addEventListener("scroll", () => { $("gutter").scrollTop=$("equations").scrollTop; });
$("target").addEventListener("input", () => { markChanged(); renderMath(displaySource($("target").value),$("targetPreview")); });
$("frequency").addEventListener("input", markChanged);
$("normalizeBtn").addEventListener("click", () => { $("equations").value=normalize($("equations").value); $("target").value=normalize($("target").value); markChanged(); updatePreview(); queueAnalysis(); toast("下标已转换为标准花括号写法"); });
$("suggestBtn").addEventListener("click", () => { suggest(); markChanged(); drawVariables(); });
$("solveBtn").addEventListener("click", solve);
document.addEventListener("keydown", e => { if (e.ctrlKey && e.key==="Enter") { e.preventDefault(); solve(); } if (e.ctrlKey && e.key.toLowerCase()==="s") { e.preventDefault(); $("saveBtn").click(); } if (e.key==="Escape" && !$("helpDialog").open) toggleFocus(false); });
$("example").addEventListener("change", () => setProject(examples[$("example").value]));
$("helpBtn").addEventListener("click", () => $("helpDialog").showModal());
$("closeHelp").addEventListener("click", () => $("helpDialog").close());
$("understoodBtn").addEventListener("click", () => $("helpDialog").close());
$("saveBtn").addEventListener("click", () => download(JSON.stringify({format:"smallsignal",version:1,...payload()},null,2),"SmallSignal-电路方程.json","application/json;charset=utf-8"));
$("openBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async e => { try { const file=e.target.files[0]; if (!file) return; if (file.size > 64000) throw new Error("项目文件过大。"); setProject(JSON.parse(await file.text())); toast("项目已打开"); } catch(error) { toast(error.message); } finally { e.target.value=""; } });
document.querySelectorAll("[data-form]").forEach(button => button.addEventListener("click", () => { currentForm=button.dataset.form; renderResult(); }));
$("copyBtn").addEventListener("click", ()=>copyResult());
$("copyExpandedBtn").addEventListener("click", ()=>copyResult(true));
$("exportBtn").addEventListener("click", exportRecord);
$("fitBtn").addEventListener("click", ()=> {
  fitOutput=!fitOutput; $("fitBtn").setAttribute("aria-pressed",String(fitOutput)); $("fitBtn").classList.toggle("active",fitOutput);
  $("fitBtn").textContent=fitOutput ? "整体适配" : "原始大小"; fitResultMath();
});
$("focusBtn").addEventListener("click",()=>toggleFocus());
window.addEventListener("resize",()=>{ clearTimeout(resizeTimer); resizeTimer=setTimeout(()=>{if(result) renderResult();},120); });
document.fonts.ready.then(()=>{if(result) renderResult();});
async function init() {
  let draft;
  try { draft=JSON.parse(localStorage.getItem("smallsignal-draft")); } catch (_) {}
  try { token=(await (await fetch("/api/session")).json()).token; setProject(draft || examples.user); }
  catch(error) { $("inputNotice").textContent="本机计算服务未连接，请重新启动软件。"; $("inputNotice").hidden=false; }
}
init();
