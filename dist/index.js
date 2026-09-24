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
function p(e, t, n, r) {
	let i = e[t];
	return typeof i != "number" || !Number.isFinite(i) ? r : i < n.min ? n.min : i > n.max ? n.max : i;
}
function m(e) {
	return {
		scales: l.map((t, n) => p(e, d(n), f.scale, r.scales[n])),
		halo: p(e, u.halo, f.halo, r.halo),
		noiseFloor: p(e, u.noiseFloor, f.noiseFloor, r.noiseFloor)
	};
}
function h(e) {
	let t = {};
	return l.forEach((n, r) => {
		t[d(r)] = e.scales[r];
	}), t[u.halo] = e.halo, t[u.noiseFloor] = e.noiseFloor, t[u.on] = +!!i(e), t;
}
function g() {
	return h(r);
}
function _(e) {
	if (!l.some((t, n) => d(n) in e)) return null;
	let t = h(m(e));
	return e[u.on] === t[u.on] ? null : t;
}
//#endregion
//#region src/runtime.ts
var v = null;
function y(e) {
	v = e;
}
function b() {
	if (!v) throw Error("[pyramid-local-contrast] api() called before activate()");
	return v;
}
function x(e, t, ...n) {
	return b().react.createElement(e, t, ...n);
}
//#endregion
//#region src/Panel.ts
var S = Array.from({ length: 8 }, (e, t) => ({
	label: `Scale ${t + 1}`,
	...f.scale,
	read: (e) => e.scales[t],
	write: (e, n) => ({
		...e,
		scales: e.scales.map((e, r) => r === t ? n : e)
	}),
	commitLabel: `scale ${t + 1}`
})), C = [{
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
}], w = "Scale 1 is the finest texture, scale 8 the broadest local tone; each scale is twice the size of the last. Up boosts, down smooths.", T = {
	display: "flex",
	flexDirection: "column",
	gap: 1
};
function E() {
	let { Slider: e } = b().components, { Stack: t, tokens: n } = b().ui, i = b().stores.useDevelopStore, a = m(i((e) => e.paramBag)), o = () => m(i.getState().paramBag), s = (e) => i.getState().setDynParams(h(e)), c = (e) => void i.getState().commitEdit(`Pyramid Local Contrast ${e}`), l = (t) => x(e, {
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
	return x(t, {
		gap: 6,
		style: { padding: "6px 8px 8px" }
	}, x("div", {
		key: "scales",
		style: T
	}, ...S.map(l)), x("p", {
		key: "hint",
		style: u
	}, w), x("div", {
		key: "options",
		style: T
	}, ...C.map(l)));
}
//#endregion
//#region src/glsl.ts
function D(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t : `${t}.0`;
}
var O = D, k = l.slice(0, -1).reduceRight((e, t, n) => `(k == ${n} ? ${t} : ${e})`, l[7]), A = `
float plcB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${O(t[2])} : (d == 1 ? ${O(t[1])} : ${O(t[0])}); }
float plcLog(float n) { return log2(max(n, 0.0) + noiseFloor * 0.01 + ${O(n)}); }
vec3 plcStateOf(vec3 p) { return uPrevRaw ? vec3(sqrt(dot(p, p) / 3.0), 0.0, 0.0) : p; }
vec3 plcState(vec2 uv) { return plcStateOf(readPrev(uv)); }
float plcLevel(vec3 st) { return plcLog(st.x) + st.y; }
float plcGain(int k) { return ${k}; }
`, j = `
{
  float longEdge = max(1.0 / uTexel.x, 1.0 / uTexel.y);
  float s = exp2(float(uPassIndex)) * longEdge / ${O(e)};
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
  float d = clamp(Lc - coarse, ${O(-5)}, ${O(5)});
  float acc = st.z + plcGain(uPassIndex) * 0.01 * d;
  c = uPassIndex == uPassCount - 1 ? vec3(acc, 0.0, 0.0) : vec3(st.x, coarse - plcLog(st.x), acc);
}
`, M = `
{
  if (on > 0.5) {
    lin *= exp2(clamp(stageResult.x, ${O(-8)}, ${O(8)}));
  }
}
`;
//#endregion
//#region src/stage.ts
function N() {
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
function P() {
	return {
		glsl: j,
		helpers: A,
		iterations: 8,
		uniforms: N()
	};
}
function F() {
	return {
		id: c,
		name: "Pyramid Local Contrast",
		phase: "scene-linear",
		priority: 60,
		glsl: M,
		uniforms: [{
			key: "on",
			glslType: "float",
			default: 0
		}],
		passes: [P()],
		presetScope: "global"
	};
}
function I() {
	return [F()];
}
//#endregion
//#region src/index.ts
var L = `${a}.panel`, R = null;
function z() {
	let e = b().stores.useDevelopStore.getState();
	e.setDynParams(g()), e.commitEdit("Pyramid Local Contrast reset");
}
function B(e) {
	y(e);
	for (let t of I()) e.registerProcessingStage(t);
	e.registerPanel({
		id: L,
		title: "Pyramid Local Contrast",
		component: E,
		defaultDock: {
			module: "develop",
			direction: "right",
			order: 7,
			width: 268
		},
		onReset: z
	}), R = e.stores.useDevelopStore.subscribe((e, t) => {
		if (e.paramBag === t.paramBag) return;
		let n = _(e.paramBag);
		n && e.setDynParams(n);
	});
}
function V() {
	R?.(), R = null;
	try {
		let e = b();
		for (let t of I()) e.unregisterProcessingStage(t.id);
	} catch {}
}
//#endregion
export { B as activate, V as deactivate };

//# sourceMappingURL=index.js.map