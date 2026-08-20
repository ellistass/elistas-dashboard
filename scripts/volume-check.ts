// Sanity check for the volume module. The claims being tested are the ones the
// chart actually depends on: the MA never looks ahead, the alpha ramp is
// monotonic, the clip stops one climax bar flattening the tape, ABSORB and
// CLIMAX separate correctly, and an untrusted feed renders inert.
import { volMA, volScale, volAlpha, barER, volumeView, type VolBar } from "../lib/chart/volume";

const b = (v: number, h = 101, l = 99, c = 100): VolBar => ({ o: 100, h, l, c, v });

let fails = 0;
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!ok) fails++;
};

console.log("── moving average ──");
const flat = Array.from({ length: 30 }, () => b(1000));
const ma = volMA(flat);
check("flat tape → flat MA", ma.every((x) => Math.abs(x - 1000) < 1e-9));
check("first value is the first bar", volMA([b(500), b(1500)])[0] === 500);
check("second value is the mean of two", volMA([b(500), b(1500)])[1] === 1000);

// No-lookahead: a spike at the END must not change the MA at earlier indices.
const withSpike = [...flat.slice(0, 29), b(999_999)];
const maSpike = volMA(withSpike);
check(
  "MA never looks ahead",
  maSpike.slice(0, 29).every((x, i) => Math.abs(x - ma[i]) < 1e-9),
  "a spike on the last bar left every earlier MA value untouched",
);

console.log("\n── alpha ramp ──");
check("2x average glows", volAlpha(2000, 1000) === 0.95);
check("1.3x is elevated", volAlpha(1300, 1000) === 0.6);
check("average is baseline", volAlpha(1000, 1000) === 0.3);
check("half average recedes", volAlpha(500, 1000) === 0.18);
check("ramp is monotonic", volAlpha(500, 1000) < volAlpha(1000, 1000) &&
  volAlpha(1000, 1000) < volAlpha(1300, 1000) && volAlpha(1300, 1000) < volAlpha(2000, 1000));
check("zero MA does not divide by zero", Number.isFinite(volAlpha(1000, 0)));

console.log("\n── clipped scale ──");
const climaxTape = [...Array.from({ length: 89 }, () => b(1000)), b(50_000)];
const sc = volScale(climaxTape);
check("ceiling sits near normal volume, not the climax", sc.maxV < 10_000, `maxV=${Math.round(sc.maxV)}`);
check("the climax bar is flagged clipped", sc.clipped(50_000));
check("a normal bar is not clipped", !sc.clipped(1000));
check(
  "normal bars keep useful height",
  1000 / sc.maxV > 0.15,
  `a normal bar renders at ${Math.round((1000 / sc.maxV) * 100)}% of the pane`,
);
// Without clipping the same bar would be 1000/50000 = 2% tall — a stub.
check("clipping is what saves them", 1000 / 50_000 < 0.05);
check("ceiling never exceeds the true max", volScale([b(10), b(20)]).maxV <= 20);
check("empty series does not explode", volScale([]).maxV === 1);

console.log("\n── effort vs result ──");
const base = Array.from({ length: 20 }, () => b(1000, 101, 99));
const absorb = [...base, b(2500, 100.4, 99.6)];   // heavy volume, narrow spread
const climax = [...base, b(2500, 105, 95)];       // heavy volume, wide spread
const noopp = [...base, b(400, 105, 95)];         // light volume, wide spread
const quiet = [...base, b(400, 100.4, 99.6)];     // light volume, narrow spread
check("ABSORB detected", barER(absorb, 20)?.tag === "ABSORB", barER(absorb, 20)?.desc);
check("CLIMAX detected", barER(climax, 20)?.tag === "CLIMAX", barER(climax, 20)?.desc);
check("NO-OPP detected", barER(noopp, 20)?.tag === "NO-OPP");
check("QUIET detected", barER(quiet, 20)?.tag === "QUIET");
check("ordinary bar gets no tag", barER([...base, b(1000, 101, 99)], 20)?.tag === null);
check("too little history → null, not a guess", barER([b(1000), b(1000), b(1000)], 2) === null);

console.log("\n── untrusted feed ──");
const trusted = volumeView(climax, { trusted: true });
const untrusted = volumeView(climax, { trusted: false });
check("trusted feed brightens the climax", trusted.alphaAt(20) === 0.95);
check("untrusted feed renders flat", untrusted.alphaAt(20) === 0.3);
check("untrusted feed suppresses effort tags", untrusted.effortAt(20) === null);
check("trusted feed still tags it", trusted.effortAt(20)?.tag === "CLIMAX");

console.log(fails === 0 ? "\nAll volume checks passed." : `\n${fails} FAILED`);
