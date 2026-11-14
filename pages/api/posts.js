import {createSign} from 'node:crypto';
import {publicRecords} from '../../utils/sheetRecords.cjs';
let cached;
async function token(){
 if(cached&&cached.expires>Date.now())return cached.token;
 const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key=process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g,'\n');
 if(!email||!key)throw new Error('Missing service account configuration');
 const now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end();
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+signer.sign(key,'base64url')}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Google authentication failed');const result=await response.json();
 cached={token:result.access_token,expires:Date.now()+(result.expires_in-120)*1000};return cached.token;
}
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
 try{
  const id=process.env.GOOGLE_SHEETS_SPREADSHEET_ID;if(!id)throw new Error('Missing spreadsheet configuration');
  const access=await token();const range=encodeURIComponent("'Posts'!A1:R10000");
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/${range}?valueRenderOption=FORMATTED_VALUE`,{headers:{Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Spreadsheet read failed');const data=await response.json();
  res.setHeader('Cache-Control','public, s-maxage=60');return res.status(200).json({posts:publicRecords(data.values)});
 }catch(error){console.error('Posts feed:',error.message);res.setHeader('Cache-Control','no-store');return res.status(503).json({error:'The collection is temporarily unavailable. Please try again shortly.'});}
}
