if(process.env.TEST_DATABASE_URL) process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('frame ownership, wallet and local mission sync persist without duplicate rewards',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const prisma=require('../src/config/prisma'); const app=require('../index');
 const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 const user=await prisma.user.create({data:{email:'frame-'+Date.now()+'@test.com',username:'frame-'+Date.now(),coins:100}});
 const token=require('../src/utils/jwt').signToken({id:user.id});
 async function request(path,method='GET',body){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 try{
 assert.equal((await request('/frames')).body.length,6);
 assert.equal((await request('/frames/f1/select','PUT')).status,403);
 assert.equal((await request('/profile','PUT',{frameId:'f1'})).status,403);
 const purchases=await Promise.all([request('/frames/f1/purchase','POST'),request('/frames/f1/purchase','POST')]);
 assert.ok(purchases.some(r=>r.status===200));assert.equal((await request('/wallet')).body.coins,50);
 assert.equal((await request('/frames/f1/purchase','POST')).body.coins,50);
 assert.equal((await request('/frames/f1/select','PUT')).body.frameId,'f1');
 assert.equal((await request('/frames/f3/purchase','POST')).status,409);
 const data={version:1,gachas:[],history:[{id:'local-test-one',gachaName:'Food',resultElement:'Rice',pulledAt:new Date().toISOString()},{id:'local-test-two',gachaName:'Food',resultElement:'Pizza',pulledAt:new Date().toISOString()}]};
 assert.equal((await request('/backup','PUT',{expectedRevision:0,data})).status,200);
 assert.equal((await request('/backup','PUT',{expectedRevision:1,data})).status,200);
 const missions=(await request('/missions')).body;assert.equal(missions.find(m=>m.id==='m2').progressLabel,'2/2');assert.equal(missions.find(m=>m.id==='m3').progressLabel,'2/10');
 assert.equal((await request('/missions/m2/claim','POST')).body.coins,52);
 assert.equal((await request('/missions/m2/claim','POST')).status,409);
 assert.equal((await request('/wallet')).body.coins,52);
 }finally{await prisma.user.delete({where:{id:user.id}});await new Promise(r=>server.close(r));await prisma.$disconnect();}
});
