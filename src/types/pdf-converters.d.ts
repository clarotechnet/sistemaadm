declare module "pdfmake/build/pdfmake" {
  const pdfmake:{addVirtualFileSystem:(fonts:Record<string,string>)=>void;createPdf:(definition:Record<string,unknown>)=>{getBlob:()=>Promise<Blob>}};
  export default pdfmake;
}
declare module "pdfmake/build/vfs_fonts" {const fonts:Record<string,string>;export default fonts;}
declare module "html-to-pdfmake" {
  export default function htmlToPdfmake(html:string,options:Record<string,unknown>):unknown[];
}
