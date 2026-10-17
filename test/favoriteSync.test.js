if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
test('backup favorites persist in Favorite, remove safely, reject stale edits and repair legacy snapshots',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const prisma=require('../src/config/prisma');const app=require('../index');const {signToken}=require('../src/utils/jwt');
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port+'/api';const users=[];
 async function user(){const id=randomUUID();const u=await prisma.user.create({data:{username:id,email:id+'@test.com'}});users.push(u.id);return {...u,token:signToken({id:u.id})};}
 async function req(user,url,method='GET',body){const r=await fetch(base+url,{method,headers:{Authorization:'Bearer '+user.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 const record={id:'local-favorite-card',name:'Dinner',category:'Custom',isEqualRate:true,isFavorite:true,pullManyCount:5,randomList:[{id:'rice',element:'Rice',rate:'100%'}],localUpdatedAt:'2026-10-17T10:00:00.000Z'};
 const builtin={...record,id:'builtin-yesno',name:'Yes / No'};
 try{
   const owner=await user(),other=await user();let revision=0;
   const data=gachas=>({version:1,gachas,history:[]});
   async function sync(gachas){const r=await req(owner,'/backup','PUT',{expectedRevision:revision,data:data(gachas)});assert.equal(r.status,200);revision=r.body.revision;return r.body;}
   const initial=await sync([record,builtin]);const cardId=Number(initial.cardIds[record.id]);const builtinId=Number(initial.cardIds[builtin.id]);
   assert.equal(await prisma.favorite.count({where:{userId:owner.id}}),2);
   assert.ok((await req(owner,'/favorites')).body.some(g=>g.id===String(cardId)));
   assert.ok((await req(owner,'/favorites')).body.some(g=>g.id===String(builtinId)));
   const itemIds=(await prisma.cardItem.findMany({where:{cardId}})).map(i=>i.id);
   await sync([record,builtin]);assert.equal(await prisma.favorite.count({where:{userId:owner.id}}),2);
   assert.equal((await req(other,'/favorites/'+cardId,'PUT')).status,200);
   const removed={...record,isFavorite:false,localUpdatedAt:'2026-10-17T11:00:00.000Z'};
   await sync([removed,builtin]);
   assert.equal(await prisma.favorite.count({where:{userId:owner.id,cardId}}),0);
   assert.equal(await prisma.favorite.count({where:{userId:other.id,cardId}}),1);
   assert.deepEqual((await prisma.cardItem.findMany({where:{cardId}})).map(i=>i.id),itemIds);
   // A newer backup revision carrying older card content must not restore a removed favorite.
   await sync([record,builtin]);
   assert.equal(await prisma.favorite.count({where:{userId:owner.id,cardId}}),0);
   const migration=fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261017010000_backup_favorites/migration.sql'),'utf8');
   await prisma.$executeRawUnsafe(migration);
   assert.equal(await prisma.favorite.count({where:{userId:owner.id,cardId}}),0);
   const restored={...record,localUpdatedAt:'2026-10-17T12:00:00.000Z'};await sync([restored,builtin]);
   assert.equal(await prisma.favorite.count({where:{userId:owner.id,cardId}}),1);
   // Repair a favorite-only flag that was saved by the old server solely inside JSON.
   await prisma.favorite.deleteMany({where:{userId:owner.id,cardId}});
   await prisma.$executeRawUnsafe(migration);await prisma.$executeRawUnsafe(migration);
   assert.equal(await prisma.favorite.count({where:{userId:owner.id,cardId}}),1);
   assert.equal(await prisma.favorite.count({where:{userId:other.id,cardId}}),1);
   const conflict=await req(owner,'/backup','PUT',{expectedRevision:revision-1,data:data([{...removed,localUpdatedAt:'2026-10-17T13:00:00.000Z'}])});
   assert.equal(conflict.status,409);assert.equal(await prisma.favorite.count({where:{userId:owner.id,cardId}}),1);
   const otherSync=await req(other,'/backup','PUT',{expectedRevision:0,data:data([record])});assert.equal(otherSync.status,200);
   assert.notEqual(Number(otherSync.body.cardIds[record.id]),cardId);
   assert.equal((await req(owner,'/backup')).body.data.gachas.find(g=>g.id===record.id).isFavorite,true);
 }finally{await prisma.user.deleteMany({where:{id:{in:users}}});await new Promise(r=>server.close(r));await prisma.$disconnect();}
});
