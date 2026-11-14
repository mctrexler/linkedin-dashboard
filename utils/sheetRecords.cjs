function publicRecords(values) {
 const [headers,...rows]=values||[];
 const required=['Publication status','Author','Title','Publication date','Date precision','ISO week','Tags','LinkedIn URL','Summary preview','Record ID','Full summary Markdown'];
 if(!headers||required.some(h=>!headers.includes(h)))throw new Error('Unexpected spreadsheet columns');
 const field=(row,h)=>String(row[headers.indexOf(h)]??'').trim();
 const seen=new Set();
 return rows.flatMap(row=>{
  if(field(row,'Publication status').toLowerCase()!=='published')return [];
  const id=field(row,'Record ID'),author=field(row,'Author'),title=field(row,'Title');
  let url;try{url=new URL(field(row,'LinkedIn URL'));}catch{return [];}
  if(url.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(url.hostname)||!/^\/(posts\/|pulse\/|feed\/update\/)/.test(url.pathname))return [];
  if(!id||!author||!title||seen.has(id))return [];seen.add(id);
  const raw=field(row,'Publication date');
  const date=/^\d{4}-\d{2}-\d{2}$/.test(raw)&&!isNaN(Date.parse(raw))?raw:'';
  const week=field(row,'ISO week');
  return [{id,author,headline:title,posted_iso:date,date_precision:field(row,'Date precision'),iso_week:/^\d{4}-W\d{2}$/.test(week)?week:'',tags:field(row,'Tags'),url:url.href,summary:field(row,'Summary preview'),full_summary:field(row,'Full summary Markdown'),include:'y'}];
 });
}
module.exports={publicRecords};
