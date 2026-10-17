if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { missionData, missionPeriod } = require('../src/utils/mission');
const DAY = 86400000;
const daily = { resetEveryDays:1, resetAnchorDate:'2026-01-05', scheduleVersion:1 };

test('mission rounds change exactly at Bangkok midnight and weekly rounds start Monday', () => {
  const before=missionPeriod(daily,new Date('2026-10-17T16:59:59.999Z'));
  const after=missionPeriod(daily,new Date('2026-10-17T17:00:00.000Z'));
  assert.equal(before.key,'1:2026-10-17');assert.equal(after.key,'1:2026-10-18');
  assert.equal(before.nextResetAt.toISOString(),'2026-10-17T17:00:00.000Z');
  const weekly=missionPeriod({...daily,resetEveryDays:7},new Date('2026-10-18T16:59:59.999Z'));
  assert.equal(weekly.key,'1:2026-10-12');assert.equal(weekly.nextResetAt.toISOString(),'2026-10-18T17:00:00.000Z');
  const leap=missionPeriod({...daily,resetEveryDays:3,resetAnchorDate:'2028-02-28'},new Date('2028-03-01T12:00:00Z'));
  assert.equal(leap.key,'1:2028-02-28');assert.equal(leap.nextResetAt.toISOString(),'2028-03-01T17:00:00.000Z');
  assert.equal(missionPeriod({...daily,resetEveryDays:null},new Date()).key,'1:lifetime');
  assert.equal(missionPeriod({...daily,resetAnchorDate:'2999-01-01'},new Date()).active,false);
});
test('admin validates recurrence, dates, rewards and achievable login targets',()=>{
  const valid={title:'Daily',event:'pull',target:2,coinReward:3,...daily};
  assert.equal(missionData(valid).resetEveryDays,1);
  assert.equal(missionData({...valid,resetEveryDays:null}).resetEveryDays,null);
  for(const data of [{target:0},{coinReward:-1},{resetEveryDays:0},{resetEveryDays:1.5},{resetEveryDays:3651},{resetAnchorDate:'2026-02-30'},{resetAnchorDate:'bad'},{event:'coins'},{title:''},{event:'login',target:3,resetEveryDays:1}]) assert.throws(()=>missionData({...valid,...data}));
});

test('mission reset integration: rewards, admin edits, offline sync and concurrency', {skip:!process.env.TEST_DATABASE_URL}, async t=>{
  const prisma=require('../src/config/prisma');
  const economy=require('../src/services/economy.service');
  const app=require('../index');
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const oldKey=process.env.ADMIN_API_KEY;process.env.ADMIN_API_KEY='mission-integration-key';
  const users=[],missions=[];
  async function user(){const key=randomUUID();const u=await prisma.user.create({data:{email:key+'@test.com',username:key,coins:0}});users.push(u.id);return u;}
  async function mission(data={}){const id='test-'+randomUUID();const m=await prisma.mission.create({data:{id,title:'Test mission',event:id,target:2,coinReward:7,...daily,...data}});missions.push(m.id);return m;}
  const state=(u,m)=>prisma.userMission.findUnique({where:{userId_missionId:{userId:u.id,missionId:m.id}}});
  const coins=async u=>(await prisma.user.findUnique({where:{id:u.id}})).coins;
  const count=(u,m,n,now,extra={})=>prisma.$transaction(tx=>economy.progress(tx,u.id,m.event,n,{now:new Date(now),...extra}));
  async function request(url,method='GET',body,headers={ 'X-Admin-Key':'mission-integration-key' }){
    const r=await fetch(base+url,{method,headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:r.status===204?null:await r.json()};
  }
  try{
    await t.test('concurrent progress pays once per round and becomes payable again after reset',async()=>{
      const u=await user(),m=await mission();
      await Promise.all(Array.from({length:8},()=>count(u,m,1,'2026-10-17T08:00:00Z')));
      assert.equal(await coins(u),7);assert.equal((await state(u,m)).claimed,true);
      const next=await economy.listMissions(u.id,new Date('2026-10-17T17:00:00Z'));
      const view=next.find(v=>v.id===m.id);assert.equal(view.progressLabel,'0/2');assert.equal(view.claimed,false);
      await assert.rejects(()=>economy.claimMission(u.id,m.id,new Date('2026-10-17T17:00:00Z')),/incomplete/);
      await Promise.all(Array.from({length:8},()=>count(u,m,1,'2026-10-17T17:01:00Z')));
      assert.equal(await coins(u),14);
      await assert.rejects(()=>economy.claimMission(u.id,m.id,new Date('2026-10-17T17:02:00Z')),/already claimed/);
    });
    await t.test('future missions stay inactive and lifetime missions preserve existing claimed state',async()=>{
      const u=await user(),future=await mission({resetAnchorDate:'2026-10-20'});
      await count(u,future,2,'2026-10-17T05:00:00Z');assert.equal((await state(u,future)).progress,0);
      await count(u,future,2,'2026-10-20T05:00:00Z');assert.equal(await coins(u),7);
      const lifetime=await mission({resetEveryDays:null});
      await prisma.userMission.create({data:{userId:u.id,missionId:lifetime.id,progress:2,claimed:true}});
      await count(u,lifetime,2,'2027-01-20T05:00:00Z');assert.equal(await coins(u),7);
      assert.equal((await state(u,lifetime)).periodKey,'1:lifetime');
    });
    await t.test('old and future offline events do not count in the current daily cycle',async()=>{
      const u=await user(),m=await mission();const now='2026-10-17T05:00:00Z';
      await count(u,m,3,now,{eventTimes:['2026-10-16T05:00:00Z','2026-10-17T04:00:00Z','2026-10-18T04:00:00Z']});
      assert.equal((await state(u,m)).progress,1);assert.equal(await coins(u),0);
      await count(u,m,1,now);assert.equal(await coins(u),7);
    });
    await t.test('login counts one Bangkok day even across simultaneous requests and resets weekly',async()=>{
      const u=await user(),m=await mission({event:'login',target:3,resetEveryDays:7});
      await Promise.all([economy.loginProgress(u.id,new Date('2026-10-15T05:00:00Z')),economy.loginProgress(u.id,new Date('2026-10-15T06:00:00Z'))]);
      assert.equal((await state(u,m)).progress,1);
      await economy.loginProgress(u.id,new Date('2026-10-16T05:00:00Z'));
      await economy.loginProgress(u.id,new Date('2026-10-17T05:00:00Z'));
      assert.equal((await state(u,m)).claimed,true);
      await economy.loginProgress(u.id,new Date('2026-10-19T05:00:00Z'));
      assert.equal((await state(u,m)).progress,1);assert.equal((await state(u,m)).claimed,false);
    });
    await t.test('admin CRUD rejects users and invalid schedules; editing the schedule starts a new cycle',async()=>{
      const u=await user();const token=require('../src/utils/jwt').signToken({id:u.id});
      const data={id:'test-admin-'+randomUUID(),title:'Editable',event:'pull',target:2,coinReward:7,resetEveryDays:1,resetAnchorDate:'2026-01-05'};
      assert.equal((await request('/api/admin/missions','POST',data,{Authorization:'Bearer '+token})).status,401);
      assert.equal((await request('/api/admin/missions','POST',{...data,event:'login',resetEveryDays:1,target:3})).status,400);
      const added=await request('/api/admin/missions','POST',data);assert.equal(added.status,201);missions.push(data.id);
      assert.equal(added.body.scheduleVersion,1);
      await count(u,added.body,2,new Date().toISOString());assert.equal((await state(u,added.body)).claimed,true);
      const named={...data,title:'Renamed',coinReward:9};
      assert.equal((await request('/api/admin/missions/'+data.id,'PUT',named)).body.scheduleVersion,1);
      assert.equal((await economy.listMissions(u.id)).find(m=>m.id===data.id).claimed,true);
      const rescheduled={...named,resetEveryDays:3};
      assert.equal((await request('/api/admin/missions/'+data.id,'PUT',rescheduled)).body.scheduleVersion,2);
      const reset=(await economy.listMissions(u.id)).find(m=>m.id===data.id);assert.equal(reset.progressLabel,'0/2');assert.equal(reset.claimed,false);
      assert.equal((await request('/api/admin/missions/'+data.id,'PUT',rescheduled)).body.scheduleVersion,2);
      assert.equal((await request('/api/admin/missions/'+data.id,'DELETE')).status,204);
      assert.equal(await state(u,added.body),null);
      assert.equal((await request('/api/admin/missions/'+data.id,'PUT',named)).status,404);
    });
    await t.test('backup retries never recount old IDs, and old draws cannot finish a fresh daily mission',async()=>{
      const u=await user(),m=await mission({event:'pull',target:1,coinReward:0});
      const token=require('../src/utils/jwt').signToken({id:u.id});const headers={Authorization:'Bearer '+token};
      const old={id:'local-'+randomUUID(),gachaName:'Test',resultElement:'Old',pulledAt:new Date(Date.now()-DAY).toISOString()};
      const current={...old,id:'local-'+randomUUID(),pulledAt:new Date(Date.now()-1000).toISOString()};
      const data={version:1,gachas:[],history:[old]};
      assert.equal((await request('/api/backup','PUT',{expectedRevision:0,data},headers)).status,200);
      assert.equal((await state(u,m)).progress,0);
      data.history.push(current);
      assert.equal((await request('/api/backup','PUT',{expectedRevision:1,data},headers)).status,200);
      assert.equal((await state(u,m)).claimed,true);
      await prisma.userMission.update({where:{userId_missionId:{userId:u.id,missionId:m.id}},data:{periodKey:'1:previous-cycle'}});
      await economy.listMissions(u.id);
      assert.equal((await request('/api/backup','PUT',{expectedRevision:2,data},headers)).status,200);
      assert.equal((await state(u,m)).progress,0);
      assert.equal(await prisma.syncedPull.count({where:{userId:u.id}}),2);
    });
  }finally{
    await prisma.user.deleteMany({where:{id:{in:users}}});
    await prisma.mission.deleteMany({where:{id:{in:missions}}});
    await new Promise(r=>server.close(r));await prisma.$disconnect();
    if(oldKey===undefined)delete process.env.ADMIN_API_KEY;else process.env.ADMIN_API_KEY=oldKey;
  }
});
