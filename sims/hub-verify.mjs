// The hub verifying the couriers' positions, the build sheet's
//   "signed with: Courier app's key, held by courier app, signs location,
//    state, verified by hub"
// A courier that runs the app holds a signing key in its phone's keystore and
// publishes the public half on its own couriers document. Every position it
// writes carries the exact string it signed. The hub rebuilds that string from
// the document's own fields and checks the signature, so a position only
// counts as that courier's if the courier's key signed it — anyone else who
// can write the collection can still write a row, but cannot sign one.
//
//   node sims/hub-verify.mjs [--once]
import { fleet, ready, sleep } from "../lib/api.mjs";
import { createPublicKey, verify } from "node:crypto";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
const hid = process.env.HUB || "hub-1";
const once = argv.includes("--once");
// checks/run.mjs imports checkCourier from here. A module body that dials the
// fleet and then loops forever would hang the importer, so the watch below runs
// only when this file is the program.
const isMain = argv[1] && fileURLToPath(import.meta.url) === argv[1];
export const compass = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.floor((((deg % 360) + 382.5) % 360) / 45)];

// The claim, either shape:
//   unidatum-courier-position/v1|<courier_id>|<lon>|<lat>|<updated_at>
//   unidatum-courier-position/v2|<courier_id>|<lon>|<lat>|<heading>|<updated_at>
// v2 adds the direction the courier is facing, so a customer app can point the
// courier's icon and know the direction came from the courier, not from
// whoever last wrote the row.
export function checkCourier(c) {
  if (!c.public_key) return { state: "unsigned", why: "no public key on the document" };
  if (!c.position_claim || !c.position_sig) return { state: "unsigned", why: "no signed position" };
  const parts = String(c.position_claim).split("|");
  const v = parts[0] === "unidatum-courier-position/v2" ? 2 : parts[0] === "unidatum-courier-position/v1" ? 1 : 0;
  if (!v || parts.length !== (v === 2 ? 6 : 5)) return { state: "bad", why: "claim is not a v1 or v2 position claim" };
  const [, id, lon, lat] = parts;
  const heading = v === 2 ? parts[4] : null;
  const at = v === 2 ? parts[5] : parts[4];
  if (id !== c._id) return { state: "bad", why: `claim names ${id}, document is ${c._id}` };
  if (at !== c.updated_at) return { state: "bad", why: "claim's time is not the document's updated_at" };
  const [dlon, dlat] = c.location?.coordinates ?? [];
  if (Math.abs(Number(lon) - dlon) > 1e-6 || Math.abs(Number(lat) - dlat) > 1e-6)
    return { state: "bad", why: `claim is ${lat}, ${lon}; document is ${dlat}, ${dlon}` };
  if (heading !== null && Math.abs(((Number(heading) - Number(c.heading ?? NaN) + 540) % 360) - 180) > 0.06)
    return { state: "bad", why: `claim faces ${heading}°, document says ${c.heading}°` };
  let key;
  try { key = createPublicKey({ key: Buffer.from(c.public_key, "base64"), format: "der", type: "spki" }); }
  catch (e) { return { state: "bad", why: `public key unreadable: ${e.message}` }; }
  const ok = verify("sha256", Buffer.from(c.position_claim), { key, dsaEncoding: "der" }, Buffer.from(c.position_sig, "base64"));
  if (!ok) return { state: "forged", why: "the signature is not this key's over this claim" };
  return { state: "signed", why: `${Math.round((Date.now() - Date.parse(at)) / 1000)}s old${heading === null ? "" : `, facing ${compass(Number(heading))}`}` };
}

if (isMain) await watch();

async function watch() {
const F = fleet();
const h = F.hubs.find((x) => x.id === hid);
await ready(h.eu);
console.log(`hub-verify ${hid}: checking every courier's position against its own key`);
for (;;) {
  try {
    const couriers = await h.eu.find("couriers", {}, 0);
    const tally = { signed: 0, unsigned: 0, bad: 0, forged: 0 };
    const lines = [];
    for (const c of couriers) {
      const r = checkCourier(c);
      tally[r.state]++;
      if (r.state !== "unsigned") lines.push(`  ${r.state === "signed" ? "ok  " : "BAD "} ${c._id}  ${r.why}`);
    }
    console.log(`${new Date().toISOString().slice(11, 19)}  ${tally.signed} signed, ${tally.forged} forged, ${tally.bad} malformed, ${tally.unsigned} unsigned (the simulated couriers hold no key)`);
    for (const l of lines) console.log(l);
  } catch (e) { console.error(`${hid}: ${e.message}`); }
  if (once) break;
  await sleep(5000);
}
}
