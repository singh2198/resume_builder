import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {keywords,tailor} from './match.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function pdfEngine(pdf,action='inspect',orders=[]){
 const local=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const python=process.env.PDF_PYTHON || (existsSync(local)?local:'python3');
 return new Promise((resolve,reject)=>{
 const child=spawn(python,[path.join(root,'server/pdf/layout.py')],{stdio:['pipe','pipe','pipe']});let output='',error='';let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;child.kill();},30000);
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>32*1024*1024)child.kill();});child.stderr.on('data',chunk=>{error+=chunk.toString().slice(0,2000);});
 child.on('error',()=>{clearTimeout(timer);reject(new Error('PDF layout engine is unavailable. Run npm run setup:pdf first.'));});
 child.on('close',code=>{clearTimeout(timer);if(timedOut)return reject(new Error('PDF processing timed out. Try a simpler PDF.'));let value;try{value=JSON.parse(output);}catch{return reject(new Error('PDF layout engine is unavailable. Run npm run setup:pdf first.'));}if(code!==0||value.error)return reject(new Error(value.error||'PDF layout processing failed.'));resolve(value);});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({pdf:pdf.toString('base64'),action,orders}));
 });
}
export async function tailorPDF(pdf,jd){
 const info=await pdfEngine(pdf);const wanted=keywords(jd);
 if(info.text.length<20||info.text.length>60000)throw Error('PDF must contain 20–60,000 extractable characters. Scanned PDFs need OCR.');
 const orders=info.groups.map((g,group)=>({group,order:g.bullets.map((b,i)=>({i,rank:keywords(b.text).filter(k=>wanted.includes(k)).length})).sort((a,b)=>b.rank-a.rank||a.i-b.i).map(b=>b.i)}));
 // Build the displayed draft from the exact same safe groups as the PDF plan.
 let updated=info.text;const changes=[];
 for(const {group,order} of orders){const g=info.groups[group];const before=g.bullets.map(b=>'- '+b.text.replace(/^[•●▪\-*]\s+/,''));const after=order.map(i=>before[i]);if(before.join('\n')!==after.join('\n')){const index=updated.indexOf(before.join('\n'));if(index<0)throw Error('Could not safely map this PDF group.');changes.push({line:updated.slice(0,index).split('\n').length,description:'Moved original PDF bullet blocks within their section; fonts and spacing retained.',before:before.join('\n'),after:after.join('\n')});updated=updated.slice(0,index)+after.join('\n')+updated.slice(index+before.join('\n').length);}}
 return {orders,result:{...tailor(info.text,jd),updatedResume:updated,changes,layoutMode:true,pageCount:info.pageCount,bulletGroups:info.groups.length}};
}
