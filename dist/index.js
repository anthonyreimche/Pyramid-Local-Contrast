var e = 2560, t = [
	1 / 16,
	4 / 16,
	6 / 16,
	4 / 16,
	1 / 16
], n = 2 ** -16, r = {
	scales: Array.from({ length: 8 }, () => 0),
	halo: 0,
	noiseFloor: 0
};
function i(e) {
	return e.scales.some((e) => e !== 0);
}
//#endregion
//#region src/params.ts
var a = "pyramid-local-contrast";
function o(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) t = (t << 5) - t + e.charCodeAt(n) | 0;
	return (t >>> 0).toString(36).slice(0, 4);
}
function s(e, t) {
	let n = e;
	for (let r = 1; t.has(o(n)) && r < 1e3; r++) n = `${e}-${r}`;
	return n;
}
var c = s(`${a}.pyramid`, /* @__PURE__ */ new Set()), l = Array.from({ length: 8 }, (e, t) => `scale${t + 1}`), u = Object.fromEntries([
	"halo",
	"noiseFloor",
	"on"
].map((e) => [e, `${c}.${e}`]));
function d(e) {
	return `${c}.${l[e]}`;
}
var f = {
	scale: {
		min: -100,
		max: 100,
		step: 1
	},
	halo: {
		min: -100,
		max: 100,
		step: 1
	},
	noiseFloor: {
		min: 0,
		max: 5,
		step: .01
	}
};
function p() {
	return [
		...l.map((e, t) => d(t)),
		u.halo,
		u.noiseFloor,
		u.on
	];
}
function m(e, t, n, r) {
	let i = e[t];
	return typeof i != "number" || !Number.isFinite(i) ? r : i < n.min ? n.min : i > n.max ? n.max : i;
}
function h(e) {
	return {
		scales: l.map((t, n) => m(e, d(n), f.scale, r.scales[n])),
		halo: m(e, u.halo, f.halo, r.halo),
		noiseFloor: m(e, u.noiseFloor, f.noiseFloor, r.noiseFloor)
	};
}
function g(e) {
	let t = {};
	return l.forEach((n, r) => {
		t[d(r)] = e.scales[r];
	}), t[u.halo] = e.halo, t[u.noiseFloor] = e.noiseFloor, t[u.on] = +!!i(e), t;
}
function _() {
	return g(r);
}
function v(e) {
	if (!l.some((t, n) => d(n) in e)) return null;
	let t = g(h(e));
	return e[u.on] === t[u.on] ? null : t;
}
//#endregion
//#region src/runtime.ts
var y = null;
function b(e) {
	y = e;
}
function x() {
	if (!y) throw Error("[pyramid-local-contrast] api() called before activate()");
	return y;
}
function S(e, t, ...n) {
	return x().react.createElement(e, t, ...n);
}
//#endregion
//#region src/Panel.ts
var C = Array.from({ length: 8 }, (e, t) => ({
	label: `Scale ${t + 1}`,
	...f.scale,
	read: (e) => e.scales[t],
	write: (e, n) => ({
		...e,
		scales: e.scales.map((e, r) => r === t ? n : e)
	}),
	commitLabel: `scale ${t + 1}`
})), w = [{
	label: "Halo control",
	...f.halo,
	read: (e) => e.halo,
	write: (e, t) => ({
		...e,
		halo: t
	}),
	commitLabel: "halo control"
}, {
	label: "Noise floor",
	...f.noiseFloor,
	read: (e) => e.noiseFloor,
	write: (e, t) => ({
		...e,
		noiseFloor: t
	}),
	commitLabel: "noise floor"
}], T = "Scale 1 is the finest texture, scale 8 the broadest local tone; each scale is twice the size of the last. Up boosts, down smooths.", E = {
	display: "flex",
	flexDirection: "column",
	gap: 1
};
function D() {
	let { Slider: e } = x().components, { Stack: t, tokens: n } = x().ui, i = x().develop.useParamScope(), a = h(i.getParams()), o = () => h(i.getParams()), s = (e) => i.setParams(g(e)), c = (e) => i.commit(`Pyramid Local Contrast ${e}`), l = (t) => S(e, {
		key: t.label,
		label: t.label,
		value: t.read(a),
		min: t.min,
		max: t.max,
		step: t.step,
		defaultValue: t.read(r),
		onChange: (e) => s(t.write(o(), e)),
		onCommit: () => c(t.commitLabel)
	}), u = {
		margin: 0,
		fontSize: 10,
		lineHeight: 1.4,
		color: n.textMuted
	};
	return S(t, {
		gap: 6,
		style: { padding: "6px 8px 8px" }
	}, S("div", {
		key: "scales",
		style: E
	}, ...C.map(l)), S("p", {
		key: "hint",
		style: u
	}, T), S("div", {
		key: "options",
		style: E
	}, ...w.map(l)));
}
//#endregion
//#region src/glsl.ts
function O(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t : `${t}.0`;
}
var k = O, A = l.slice(0, -1).reduceRight((e, t, n) => `(k == ${n} ? ${t} : ${e})`, l[7]), j = `
float plcB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${k(t[2])} : (d == 1 ? ${k(t[1])} : ${k(t[0])}); }
float plcLog(float n) { return log2(max(n, 0.0) + noiseFloor * 0.01 + ${k(n)}); }
vec3 plcStateOf(vec3 p) { return uPrevRaw ? vec3(sqrt(dot(p, p) / 3.0), 0.0, 0.0) : p; }
vec3 plcState(vec2 uv) { return plcStateOf(readPrev(uv)); }
float plcLevel(vec3 st) { return plcLog(st.x) + st.y; }
float plcGain(int k) { return ${A}; }
`, M = `
{
  float longEdge = max(1.0 / uTexel.x, 1.0 / uTexel.y);
  float s = exp2(float(uPassIndex)) * longEdge / ${k(e)};
  float sigma = exp2(-halo / 50.0);
  vec3 st = plcStateOf(c);
  float Lc = plcLevel(st);
  float sum = 0.0;
  float wsum = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      float Ls = plcLevel(plcState(vUv + vec2(float(dx), float(dy)) * s * uTexel));
      float dL = (Ls - Lc) / sigma;
      float w = plcB3(dx) * plcB3(dy) * exp(-0.5 * dL * dL);
      sum += w * Ls;
      wsum += w;
    }
  }
  float coarse = sum / wsum;
  float d = clamp(Lc - coarse, ${k(-5)}, ${k(5)});
  float acc = st.z + plcGain(uPassIndex) * 0.01 * d;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(st.x, coarse - plcLog(st.x), acc);
}
`, N = `
{
  if (on > 0.5) {
    lin *= exp2(clamp(stageResult.x, ${k(-8)}, ${k(8)}));
  }
}
`;
//#endregion
//#region src/stage.ts
function P() {
	return [
		...l.map((e, t) => ({
			key: e,
			glslType: "float",
			default: 0,
			range: { ...f.scale },
			label: `scale ${t + 1}`
		})),
		{
			key: "halo",
			glslType: "float",
			default: 0,
			range: { ...f.halo },
			label: "halo control"
		},
		{
			key: "noiseFloor",
			glslType: "float",
			default: 0,
			range: { ...f.noiseFloor },
			label: "noise floor"
		}
	];
}
function F() {
	return {
		glsl: M,
		helpers: j,
		iterations: 8,
		uniforms: P()
	};
}
function I() {
	return {
		id: c,
		name: "Pyramid Local Contrast",
		phase: "scene-linear",
		priority: 60,
		glsl: N,
		uniforms: [{
			key: "on",
			glslType: "float",
			default: 0
		}],
		passes: [F()],
		presetScope: "global",
		mask: { maskable: !0 }
	};
}
function L() {
	return [I()];
}
//#endregion
//#region src/index.ts
var R = `${a}.panel`, z = null;
function B() {
	let e = x().stores.useDevelopStore.getState();
	e.setDynParams(_()), e.commitEdit("Pyramid Local Contrast reset");
}
function V(e) {
	b(e);
	for (let t of L()) e.registerProcessingStage(t);
	e.registerPanel({
		id: R,
		title: "Pyramid Local Contrast",
		component: D,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 7,
			width: 268
		},
		onReset: B,
		mask: {
			component: D,
			owns: p()
		}
	}), z = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.paramBag === t.paramBag) return;
		let n = v(e.paramBag);
		n && e.setDynParams(n);
	});
}
function H() {
	z?.(), z = null;
	try {
		let e = x();
		for (let t of L()) e.unregisterProcessingStage(t.id);
	} catch {}
}
//#endregion
export { V as activate, H as deactivate };

//# sourceMappingURL=index.js.map