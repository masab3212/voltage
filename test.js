// Unit tests for the calculation module. Run: node test.js
const Calc = require("./app.js");

let failed = 0;
function eq(name, got, want, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + `  ${name}: got ${got}, want ${want}`);
}

const s = { v: 60, ah: 20, eff: 87, mode: "battery" };

// 60V 20Ah @87%, 20% -> 100%  (per the spec's formulas)
const sess = Calc.session(s, 20, 100);
eq("session battery kWh", sess.battery, 0.96);
eq("session meter kWh", sess.units, 1.103);
eq("session loss kWh", sess.loss, 1.103 - 0.96);

// Motor wattage must not affect anything
const sMotor = { ...s, motor: 999999 };
eq("motor excluded", Calc.session(sMotor, 20, 100).units, sess.units, 1e-9);

// Measured mode uses the reading directly
const m = Calc.session({ ...s, mode: "measured" }, 0, 0, 1.5);
eq("measured units", m.units, 1.5, 1e-9);
eq("measured battery", m.battery, 1.5 * 0.87, 1e-9);

// Bill: Rs 18000 / 300 units / 6 residents / marginal 65 / my 28 units
const b = Calc.billSplit(18000, 300, 6, 65, 28);
eq("myScootyCost", b.myScootyCost, 1820);
eq("remainingBill", b.remainingBill, 16180);
eq("perResident", b.perResident, 2696.67);
eq("myTotalShare", b.myTotalShare, 4516.67);
eq("avgRate", b.avgRate, 60);

// Petrol price effective on date
const hist = [{ date: "2026-09-01", price: 100 }, { date: "2026-09-10", price: 110 }];
eq("price on 09-05", Calc.priceOn(hist, "2026-09-05"), 100, 1e-9);
eq("price on 09-15", Calc.priceOn(hist, "2026-09-15"), 110, 1e-9);
console.log("price before history:", Calc.priceOn(hist, "2026-08-01"), "(expect null)");
if (Calc.priceOn(hist, "2026-08-01") !== null) failed++;

// Savings: 30 km at 45 km/L and Rs 100/L = 66.67 avoided, minus Rs 10 electricity
const sv = Calc.savings(
  [{ date: "2026-09-05T10:00:00Z", km: 30, cost: 10 },
   { date: "2026-09-06T10:00:00Z", km: null, cost: 5 }],
  hist, 45);
eq("petrol avoided", sv.petrol, 66.67);
eq("net saving", sv.net, 56.67);
eq("excluded count", sv.excluded, 1, 0);

process.exitCode = failed ? 1 : 0;
console.log(failed ? `\n${failed} FAILED` : "\nAll tests passed");
