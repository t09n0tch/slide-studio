'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {hash,problem}=require('../shared/service-protocol.cjs');
function createStore(filename,{clock=()=>Date.now(),timeZone='Asia/Seoul'}={}){
 if(filename!==':memory:'){fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(filename);if(filename!==':memory:')fs.chmodSync(filename,0o600);
 db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,daily_limit INTEGER NOT NULL,monthly_limit INTEGER NOT NULL,expires INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS usage(subject TEXT NOT NULL,period TEXT NOT NULL,pages INTEGER NOT NULL,PRIMARY KEY(subject,period));
 CREATE TABLE IF NOT EXISTS jobs(user_id TEXT NOT NULL,id TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL,response TEXT,error TEXT,created INTEGER NOT NULL,input_tokens INTEGER,output_tokens INTEGER,PRIMARY KEY(user_id,id));`);
 const day=()=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(clock()));const p=Object.fromEntries(parts.map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}`;};
 const pages=(subject,period)=>db.prepare('SELECT pages FROM usage WHERE subject=? AND period=?').get(subject,period)?.pages||0;
 const add=(subject,period,count)=>db.prepare('INSERT INTO usage(subject,period,pages) VALUES(?,?,?) ON CONFLICT(subject,period) DO UPDATE SET pages=pages+excluded.pages').run(subject,period,count);
 // Keep content-free request IDs after the result expires so a late retry cannot infer twice.
 function prune(){db.prepare('UPDATE jobs SET response=NULL WHERE response IS NOT NULL AND created<?').run(clock()-86400000);}
 function invite({name,daily=20,monthly=200,days=30}){if(typeof name!=='string'||!name.trim()||name.length>100||![daily,monthly,days].every(v=>Number.isInteger(v)&&v>0)||days>366||daily>100000||monthly>1000000)throw Error('이름과 이용 한도를 확인해 주세요.');const token=crypto.randomBytes(24).toString('base64url'),id=crypto.randomUUID();db.prepare('INSERT INTO users(id,name,token_hash,daily_limit,monthly_limit,expires) VALUES(?,?,?,?,?,?)').run(id,name.trim(),hash(token),daily,monthly,clock()+days*86400000);return{id,token};}
 function authenticate(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,100}$/.test(token))throw problem('unauthorized',401);const user=db.prepare('SELECT * FROM users WHERE token_hash=?').get(hash(token));if(!user?.enabled||user.expires<=clock())throw problem('unauthorized',401);return user;}
 function session(user,config){const today=day(),month=today.slice(0,7);return{connected:true,enabled:!!config.enabled,user:{id:user.id,name:user.name},quota:{dailyRemaining:Math.max(0,Math.min(user.daily_limit-pages(user.id,today),config.globalDaily-pages("*",today))),monthlyRemaining:Math.max(0,Math.min(user.monthly_limit-pages(user.id,month),config.globalMonthly-pages("*",month))),dailyLimit:user.daily_limit,monthlyLimit:user.monthly_limit,timeZone},serviceName:'Slide Studio AI'};}
 function existing(user,id,digest){prune();const job=db.prepare('SELECT * FROM jobs WHERE user_id=? AND id=?').get(user.id,id);if(job&&job.body_hash!==digest)throw problem('request_changed',409);return job;}
 function reserve(user,id,digest,count,config){
  const today=day(),month=today.slice(0,7);db.exec('BEGIN IMMEDIATE');
  try{
   const current=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);if(!current?.enabled||current.expires<=clock())throw problem('unauthorized',401);
   if(db.prepare('SELECT 1 FROM jobs WHERE user_id=? AND id=?').get(user.id,id))throw problem('busy',409);
   if(!config.enabled||config.globalDaily<=0||config.globalMonthly<=0)throw problem('disabled',503);
   if(pages(user.id,today)+count>current.daily_limit||pages(user.id,month)+count>current.monthly_limit||pages('*',today)+count>config.globalDaily||pages('*',month)+count>config.globalMonthly)throw problem('quota_exceeded',429);
   for(const subject of [user.id,'*'])for(const period of [today,month])add(subject,period,count);
   db.prepare('INSERT INTO jobs(user_id,id,body_hash,state,created) VALUES(?,?,?,?,?)').run(user.id,id,digest,'running',clock());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function complete(user,id,text,usage={}){db.prepare("UPDATE jobs SET state='completed',response=?,input_tokens=?,output_tokens=? WHERE user_id=? AND id=?").run(text,Number.isInteger(usage.input_tokens)?usage.input_tokens:null,Number.isInteger(usage.output_tokens)?usage.output_tokens:null,user.id,id);}
 function fail(user,id,code){db.prepare("UPDATE jobs SET state='failed',error=? WHERE user_id=? AND id=?").run(code,user.id,id);}
 return{invite,authenticate,session,existing,reserve,complete,fail,prune,recover(){db.exec("UPDATE jobs SET state='failed',error='uncertain' WHERE state='running'");},list(){return db.prepare('SELECT id,name,daily_limit,monthly_limit,expires,enabled FROM users ORDER BY name').all();},revoke(id){db.prepare('UPDATE users SET enabled=0 WHERE id=?').run(id);},close(){db.close();}};
}
module.exports={createStore};
