// Synthetic workbooks only; never use employee data in browser fixtures.
// ARTIFACT_TOOL_MODULE can point to the bundled artifact_tool.mjs entry point.
import {mkdir,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const {SpreadsheetFile,Workbook}=process.env.ARTIFACT_TOOL_MODULE?await import(pathToFileURL(process.env.ARTIFACT_TOOL_MODULE).href):await import("@oai/artifact-tool");
const directory=process.env.OVERTIME_FIXTURE_DIR??"tmp/overtime-qa";
await mkdir(directory,{recursive:true});
const workbook=Workbook.create(),sheet=workbook.worksheets.add("Referência");
sheet.getRange("A1:D6").values=[
  ["Colaborador","H. EX 50%","H. EX 60%","H. EX 100%"],
  ["Ana Teste","00:00","21:55","00:00"],
  ["Bruno Teste","28:70","",""],
  ["Carlla Teste","","","01:00"],
  ["Zulmira Qwx Yz","01:00","",""],
  ["Pessoa sem PDF","02:00","",""],
];
sheet.getRange("A1:D6").format.font={name:"Arial",size:11};
sheet.getRange("A1:D1").format.font={name:"Arial",size:11,bold:true};
sheet.getRange("A1:D6").format.columnWidth=22;
sheet.getRange("A1:D6").format.rowHeight=20;
sheet.getRange("B2:D6").setNumberFormat("@");
workbook.recalculate();
const rendered=await workbook.render({sheetName:"Referência",range:"A1:D6",scale:1.5,format:"png"});
await writeFile(`${directory}/fixture.png`,new Uint8Array(await rendered.arrayBuffer()));
await(await SpreadsheetFile.exportXlsx(workbook)).save(`${directory}/referencia-09.2026.xlsx`);
sheet.getRange("B3").values=[["28:59"]];
sheet.getRange("C2").values=[["21:54"]];
workbook.recalculate();
await(await SpreadsheetFile.exportXlsx(workbook)).save(`${directory}/corrigida-09.2026.xlsx`);
console.log("Two synthetic overtime workbooks and their preview are ready.");
