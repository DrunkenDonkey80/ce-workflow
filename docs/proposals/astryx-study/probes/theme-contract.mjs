// P3-02: installed-version public theme API, no copied generator or React output.
// Usage: STUDY_DEPS=<installed node_modules> node docs/proposals/astryx-study/probes/theme-contract.mjs
import assert from "node:assert/strict";
import path from "node:path";
import {pathToFileURL} from "node:url";
assert.ok(process.env.STUDY_DEPS,"Set STUDY_DEPS to the reviewed installed node_modules");
const {generateTonalPalette}=await import(pathToFileURL(path.join(process.env.STUDY_DEPS,"@astryxdesign/cli/api/index.mjs")).href);
const request={families:[{id:"accent",seed:"#c2410c"},{id:"neutral",seed:"#767676",kind:"neutral"}],modeStrategy:"light-and-dark"};
const result=generateTonalPalette(request);
assert.deepEqual(result,generateTonalPalette(request),"Palette generation must be deterministic");
assert.equal(result.recipe,"astryx-oklch-v1");assert.equal(result.schemaVersion,1);
for(const family of ["accent","neutral"])for(const mode of ["light","dark"]){
 assert.equal(Object.keys(result.palette[family][mode]).length,result.stops.length);
 assert.ok(Object.values(result.palette[family][mode]).every(color=>/^#[0-9a-f]{6}$/i.test(color)));
}
assert.throws(()=>generateTonalPalette({families:[{id:"bad",seed:"not-a-color"}]}));
assert.throws(()=>generateTonalPalette({...request,stops:[-1,101]}));
const pinned=generateTonalPalette({stops:[50],families:[{id:"accent",seed:"#c2410c",anchors:[{mode:"light",stop:50,color:"#c2410c",policy:"exact"}]}]});
assert.equal(pinned.palette.accent.light[50],"#c2410c");
console.log(JSON.stringify({recipe:result.recipe,stops:result.stops,families:Object.keys(result.palette),modes:Object.keys(result.palette.accent).filter(k=>k!=="name"),sample:{accentLight50:result.palette.accent.light[50],accentDark50:result.palette.accent.dark[50]},exactAnchor:pinned.palette.accent.light[50],checks:"deterministic, both modes, hex-only output, invalid color/stops, exact anchor"},null,2));
