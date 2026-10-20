// PDF.js assets stay on the application's own origin, with the installed version.
import {cp,mkdir,copyFile} from "node:fs/promises";
import {resolve} from "node:path";
const source=resolve("node_modules/pdfjs-dist"),target=resolve("public/pdfjs");
await mkdir(target,{recursive:true});
await copyFile(resolve(source,"build/pdf.worker.min.mjs"),resolve("public/pdf.worker.min.js"));
for(const directory of ["cmaps","standard_fonts","wasm"])await cp(resolve(source,directory),resolve(target,directory),{recursive:true});
console.log("PDF.js: worker, fontes e decodificadores preparados na mesma origem.");
