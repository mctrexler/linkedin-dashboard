const {test}=require('node:test');const assert=require('node:assert/strict');const {publicRecords}=require('../utils/sheetRecords.cjs');
const headers=['Publication status','Author','Title','Publication date','Date precision','ISO week','Tags','LinkedIn URL','Summary preview','Record ID','Full summary Markdown','Source locations'];
const row=(status='Published',url='https://www.linkedin.com/posts/example',date='2026-11-10')=>[status,'Author','Title',date,'Week','2026-W46','Risk; Policy',url,'Preview','record-1','Full summary','private/path'];
test('only published rows are released',()=>{for(const status of ['Ready','Review','Excluded','','Duplicate'])assert.equal(publicRecords([headers,row(status)]).length,0);assert.equal(publicRecords([headers,row()]).length,1);});
test('private fields are omitted and duplicate IDs suppressed',()=>{const results=publicRecords([headers,row(),row()]);assert.equal(results.length,1);assert.ok(!JSON.stringify(results).includes('private/path'));});
test('invalid links are omitted',()=>{for(const url of ['javascript:alert(1)','https://linkedin.com.evil.test/posts/a','http://linkedin.com/posts/a'])assert.equal(publicRecords([headers,row('Published',url)]).length,0);});
test('week-only and relative dates are not converted to fabricated days',()=>{const r=publicRecords([headers,row('Published','https://www.linkedin.com/posts/a','3mo')])[0];assert.equal(r.posted_iso,'');assert.equal(r.iso_week,'2026-W46');});
test('missing columns fail closed',()=>assert.throws(()=>publicRecords([['Title'],['Example']])));
